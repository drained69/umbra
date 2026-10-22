import { poseidon1, poseidon3 } from "poseidon-lite";
import { x25519 } from "@noble/curves/ed25519";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { FIELD_SIZE, randomFieldElement } from "./field";

/**
 * A shielded account for the join-split model.
 *   - spend key:      `privateKey` (field), `publicKey = Poseidon(privateKey)` — owns UTXOs.
 *   - encryption key: an x25519 keypair derived from the spend key — lets others encrypt
 *                     output notes to you so you can scan and spend them.
 *
 * A shareable **shielded address** bundles `publicKey` + the x25519 public key.
 */
export class Keypair {
  privateKey: bigint;
  publicKey: bigint;
  encSecret: Uint8Array;
  encPublic: Uint8Array;

  constructor(privateKey?: bigint) {
    this.privateKey = privateKey ?? randomFieldElement();
    this.publicKey = poseidon1([this.privateKey]) % FIELD_SIZE;
    this.encSecret = keccak_256(hexToBytes(this.privateKey.toString(16).padStart(64, "0")));
    this.encPublic = x25519.getPublicKey(this.encSecret);
  }

  /** signature = Poseidon(privateKey, commitment, merklePath) */
  sign(commitment: bigint, merklePath: bigint): bigint {
    if (this.privateKey < 0n) throw new Error("receive-only keypair cannot sign");
    return poseidon3([this.privateKey, commitment, merklePath]) % FIELD_SIZE;
  }

  /** Shareable shielded address (safe to publish — reveals no spend power). */
  address(): string {
    return (
      "umbra-addr-" +
      this.publicKey.toString(16).padStart(64, "0") +
      "-" +
      bytesToHex(this.encPublic)
    );
  }

  static publicFromAddress(addr: string): { publicKey: bigint; encPublic: Uint8Array } {
    const parts = addr.replace(/^umbra-addr-/, "").split("-");
    if (parts.length !== 2 || parts[0].length !== 64 || parts[1].length !== 64) {
      throw new Error("invalid shielded address");
    }
    return { publicKey: BigInt("0x" + parts[0]), encPublic: hexToBytes(parts[1]) };
  }

  /**
   * A receive-only keypair for someone else's shielded address: it can own OUTPUTS you
   * create for them, but has no spend key (calling `sign` throws).
   */
  static fromAddress(addr: string): Keypair {
    const { publicKey, encPublic } = Keypair.publicFromAddress(addr);
    const k = Object.create(Keypair.prototype) as Keypair;
    k.privateKey = -1n;
    k.publicKey = publicKey;
    k.encPublic = encPublic;
    k.encSecret = new Uint8Array();
    return k;
  }

  get canSpend(): boolean {
    return this.privateKey >= 0n;
  }

  /** Portable backup of the spend key. */
  serialize(): string {
    return "umbra-sk-" + this.privateKey.toString(16).padStart(64, "0");
  }
  static fromSerialized(s: string): Keypair {
    return new Keypair(BigInt("0x" + s.replace(/^umbra-sk-/, "")));
  }
}
