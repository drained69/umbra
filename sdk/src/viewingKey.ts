// Viewing keys & selective disclosure — the feature that turns Umbra from a plain
// mixer into a compliance-capable confidential-payments layer.
//
// A viewing key is a symmetric key derived from a deterministic wallet signature, so
// it is recoverable and never stored. Each shielded action can attach an encrypted
// memo (posted in the Deposit/Withdrawal event). The owner — or an AUDITOR they
// voluntarily hand the key to — can scan those events and reconstruct the full private
// history, WITHOUT any of it being public. Disclosure is user-controlled, per-key.

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { keccak_256 } from "@noble/hashes/sha3";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils";

export const VIEWING_KEY_MESSAGE = "Umbra Portaldot V3 — derive my viewing key (v1)";

/** Sign `VIEWING_KEY_MESSAGE` with an ethers Signer, hash to a 32-byte key. */
export async function deriveViewingKey(signMessage: (m: string) => Promise<string>): Promise<Uint8Array> {
  const sig = await signMessage(VIEWING_KEY_MESSAGE);
  return keccak_256(hexToBytes(sig.replace(/^0x/, "")));
}

export interface Memo {
  action: "deposit" | "transfer" | "withdraw";
  denomination: string; // decimal wei
  nullifier: string; // hex
  secret: string; // hex
  ts: number;
  note?: string; // optional recipient-facing note
}

export function encryptMemo(viewingKey: Uint8Array, memo: Memo): Uint8Array {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const plaintext = utf8ToBytes(JSON.stringify(memo));
  const ct = xchacha20poly1305(viewingKey, nonce).encrypt(plaintext);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

/** Returns the memo if this key can decrypt the blob, else null (wrong key / not ours). */
export function tryDecryptMemo(viewingKey: Uint8Array, blob: Uint8Array): Memo | null {
  try {
    const nonce = blob.slice(0, 24);
    const ct = blob.slice(24);
    const pt = xchacha20poly1305(viewingKey, nonce).decrypt(ct);
    return JSON.parse(new TextDecoder().decode(pt)) as Memo;
  } catch {
    return null;
  }
}

/** Export a viewing key as a shareable hex string (hand to an auditor out-of-band). */
export function exportViewingKey(viewingKey: Uint8Array): string {
  return "umbra-vk-" + bytesToHex(viewingKey);
}

export function importViewingKey(s: string): Uint8Array {
  const hex = s.trim().replace(/^umbra-vk-/, "");
  return hexToBytes(hex);
}

/**
 * Scan a list of on-chain encrypted memos with a viewing key, returning the ones this
 * key owns. This is exactly what an auditor runs during selective disclosure.
 */
export function scanMemos(
  viewingKey: Uint8Array,
  blobs: { memo: Uint8Array; txHash?: string; blockNumber?: number }[]
): { memo: Memo; txHash?: string; blockNumber?: number }[] {
  const out: { memo: Memo; txHash?: string; blockNumber?: number }[] = [];
  for (const b of blobs) {
    const m = tryDecryptMemo(viewingKey, b.memo);
    if (m) out.push({ memo: m, txHash: b.txHash, blockNumber: b.blockNumber });
  }
  return out;
}
