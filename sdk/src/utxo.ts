import { poseidon3, poseidon4 } from "poseidon-lite";
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { keccak_256 } from "@noble/hashes/sha3";
import { Keypair } from "./keypair";
import { FIELD_SIZE, randomFieldElement } from "./field";

/** Longest memo an encrypted note can carry (UTF-8 bytes). */
export const MAX_MEMO_BYTES = 96;
/**
 * Plaintext notes are padded to this many bytes before encryption, so a note's ciphertext
 * length reveals neither the memo nor whether there is one.
 */
const PADDED_NOTE_BYTES = 384; // fits a 96-byte memo even if every character needs a JSON escape

/**
 * A UTXO (shielded note) in the join-split model.
 *   commitment = Poseidon(amount, publicKey, blinding)          (single-asset pool)
 *   commitment = Poseidon(amount, publicKey, blinding, asset)   (multi-asset pool, when `asset` is set)
 *   nullifier  = Poseidon(commitment, index, sign(commitment, index))
 * The optional memo travels only inside the encrypted output; it is not part of the commitment.
 */
export class Utxo {
  amount: bigint;
  blinding: bigint;
  keypair: Keypair; // full keypair (ours) or a public-only stub (recipient's)
  index: number; // leaf index once inserted, else -1
  memo?: string;
  /** Asset id in a multi-asset pool (0 = native token); undefined for the single-asset pool. */
  asset?: bigint;

  constructor(opts: { amount?: bigint; blinding?: bigint; keypair?: Keypair; index?: number; memo?: string; asset?: bigint } = {}) {
    this.amount = opts.amount ?? 0n;
    this.asset = opts.asset;
    this.blinding = opts.blinding ?? randomFieldElement();
    this.keypair = opts.keypair ?? new Keypair();
    this.index = opts.index ?? -1;
    if (opts.memo !== undefined) {
      const memo = opts.memo.replace(/[\u0000-\u001f\u007f]/g, " ");
      if (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) throw new Error(`memo is longer than ${MAX_MEMO_BYTES} bytes`);
      this.memo = memo;
    }
  }

  commitment(): bigint {
    if (this.asset !== undefined) return poseidon4([this.amount, this.keypair.publicKey, this.blinding, this.asset]) % FIELD_SIZE;
    return poseidon3([this.amount, this.keypair.publicKey, this.blinding]) % FIELD_SIZE;
  }

  nullifier(): bigint {
    const idx = BigInt(this.index >= 0 ? this.index : 0);
    const sig = this.keypair.sign(this.commitment(), idx);
    return poseidon3([this.commitment(), idx, sig]) % FIELD_SIZE;
  }

  /**
   * Encrypt this UTXO's secret fields to a recipient's shielded address so they can scan
   * and later spend it. Uses an ephemeral x25519 key + XChaCha20-Poly1305 (ECIES).
   */
  encryptTo(recipientEncPublic: Uint8Array): Uint8Array {
    const eph = x25519.utils.randomPrivateKey();
    const ephPub = x25519.getPublicKey(eph);
    const shared = x25519.getSharedSecret(eph, recipientEncPublic);
    const key = keccak_256(shared);
    const nonce = crypto.getRandomValues(new Uint8Array(24));
    const json = new TextEncoder().encode(
      JSON.stringify({
        amount: this.amount.toString(16),
        blinding: this.blinding.toString(16),
        ...(this.asset !== undefined ? { asset: this.asset.toString(16) } : {}),
        ...(this.memo ? { memo: this.memo } : {}),
      })
    );
    if (json.length > PADDED_NOTE_BYTES) throw new Error("note plaintext is too long");
    const payload = new Uint8Array(PADDED_NOTE_BYTES).fill(0x20); // JSON ignores trailing spaces
    payload.set(json);
    const ct = xchacha20poly1305(key, nonce).encrypt(payload);
    const out = new Uint8Array(ephPub.length + nonce.length + ct.length);
    out.set(ephPub, 0);
    out.set(nonce, ephPub.length);
    out.set(ct, ephPub.length + nonce.length);
    return out;
  }

  /** Recipient decrypts a scanned output into a spendable UTXO (index set later). */
  static decrypt(blob: Uint8Array, owner: Keypair, index: number): Utxo | null {
    try {
      const ephPub = blob.slice(0, 32);
      const nonce = blob.slice(32, 56);
      const ct = blob.slice(56);
      const shared = x25519.getSharedSecret(owner.encSecret, ephPub);
      const key = keccak_256(shared);
      const pt = xchacha20poly1305(key, nonce).decrypt(ct);
      const { amount, blinding, memo, asset } = JSON.parse(new TextDecoder().decode(pt));
      return new Utxo({
        amount: BigInt("0x" + amount),
        blinding: BigInt("0x" + blinding),
        keypair: owner,
        index,
        asset: typeof asset === "string" ? BigInt("0x" + asset) : undefined,
        memo: typeof memo === "string" && new TextEncoder().encode(memo).length <= MAX_MEMO_BYTES ? memo : undefined,
      });
    } catch {
      return null;
    }
  }
}
