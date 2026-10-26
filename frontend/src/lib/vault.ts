// Passcode protection for a spend key kept in this browser: PBKDF2-SHA256 (600,000
// iterations) stretches the passcode into an AES-256-GCM key, using Web Crypto. Only the
// ciphertext, salt and IV are stored; a wrong passcode fails GCM authentication.

export const MIN_PASSCODE = 8;
const ITERATIONS = 600_000;

export interface SealedSecret {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 ciphertext + GCM tag
  /** not secret: whether the user confirmed a backup of the key */
  backedUp: boolean;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function passcodeProblem(passcode: string, confirm?: string): string | null {
  if (passcode.length < MIN_PASSCODE) return `Use at least ${MIN_PASSCODE} characters.`;
  if (confirm !== undefined && passcode !== confirm) return "The passcodes don't match.";
  return null;
}

export async function seal(secret: string, passcode: string, backedUp: boolean): Promise<SealedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), backedUp };
}

export async function unseal(sealed: SealedSecret, passcode: string): Promise<string> {
  const key = await deriveKey(passcode, unb64(sealed.salt));
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error("That passcode is not correct.");
  }
}

export function isSealed(x: unknown): x is SealedSecret {
  return !!x && typeof x === "object" && (x as any).v === 1 && typeof (x as any).ct === "string";
}
