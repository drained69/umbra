import { poseidon3 } from "poseidon-lite";
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { keccak_256 } from "@noble/hashes/sha3";
import { Keypair } from "./keypair";
import { FIELD_SIZE, randomFieldElement } from "./field";

/**
 * A UTXO (shielded note) in the join-split model.
 *   commitment = Poseidon(amount, publicKey, blinding)
 *   nullifier  = Poseidon(commitment, index, sign(commitment, index))
 */
export class Utxo {
  amount: bigint;
  blinding: bigint;
  keypair: Keypair; // full keypair (ours) or a public-only stub (recipient's)
  index: number; // leaf index once inserted, else -1

  constructor(opts: { amount?: bigint; blinding?: bigint; keypair?: Keypair; index?: number } = {}) {
    this.amount = opts.amount ?? 0n;
    this.blinding = opts.blinding ?? randomFieldElement();
    this.keypair = opts.keypair ?? new Keypair();
    this.index = opts.index ?? -1;
  }

  commitment(): bigint {
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
    const payload = new TextEncoder().encode(
      JSON.stringify({ amount: this.amount.toString(16), blinding: this.blinding.toString(16) })
    );
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
      const { amount, blinding } = JSON.parse(new TextDecoder().decode(pt));
      return new Utxo({ amount: BigInt("0x" + amount), blinding: BigInt("0x" + blinding), keypair: owner, index });
    } catch {
      return null;
    }
  }
}
