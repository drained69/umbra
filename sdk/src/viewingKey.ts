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

/**
 * Domain-separated viewing-key message (audit L-04): bound to app, version, chain and
 * purpose, so a signature collected by another app/chain can't reproduce this key.
 */
export function viewingKeyMessage(chainId: number | bigint): string {
  return [
    "Umbra viewing key (v2)",
    `Chain ID: ${chainId}`,
    "Purpose: derive a READ-ONLY key that reveals your Umbra activity to you, or to an",
    "auditor you choose. It CANNOT move funds. Only sign this on the Umbra app.",
  ].join("\n");
}

/** Sign the domain-separated message with the wallet, hash to a 32-byte key. */
export async function deriveViewingKey(
  signMessage: (m: string) => Promise<string>,
  chainId: number | bigint
): Promise<Uint8Array> {
  const sig = await signMessage(viewingKeyMessage(chainId));
  return keccak_256(hexToBytes(sig.replace(/^0x/, "")));
}

/**
 * What a viewing key reveals. SECURITY (audit C-01): a memo must NEVER contain spend
 * secrets (nullifier / secret / private key). It carries only public-at-spend-time or
 * descriptive fields, so disclosing a viewing key reveals history but grants NO ability
 * to withdraw. `nullifierHash` becomes public when the note is spent, which is exactly
 * what lets an auditor link a deposit to its later withdrawal — read-only.
 */
export interface Memo {
  action: "deposit" | "transfer" | "withdraw";
  denomination: string; // decimal EVM wei (18-dec)
  commitment: string; // hex — the on-chain leaf
  nullifierHash: string; // hex — revealed on-chain at withdrawal
  ts: number;
  note?: string; // optional free-text label
}

const FORBIDDEN_MEMO_KEYS = ["nullifier", "secret", "privateKey", "blinding", "spendKey"];

export function encryptMemo(viewingKey: Uint8Array, memo: Memo): Uint8Array {
  // Defense in depth: refuse to encrypt anything that would grant spend authority.
  for (const k of FORBIDDEN_MEMO_KEYS) {
    if (k in (memo as unknown as Record<string, unknown>)) {
      throw new Error(`refusing to put spend secret '${k}' in a viewing-key memo`);
    }
  }
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
