import { poseidon2 } from "poseidon-lite";
import { FIELD_SIZE, randomFieldElement } from "./field.js";

/**
 * An Umbra note = the secret opening of a commitment that sits in a pool's Merkle tree.
 *
 *   commitment    = Poseidon(nullifier, secret)
 *   nullifierHash = Poseidon(nullifier, 0)
 *
 * These definitions are identical in the circom circuit and the on-chain IHasher, so
 * a commitment computed here will be found in the tree and provable in the SNARK.
 */
export interface Note {
  nullifier: bigint;
  secret: bigint;
  /** which denomination pool this note belongs to (in wei of tPOT) */
  denomination: bigint;
}

export function createNote(denomination: bigint): Note {
  return {
    nullifier: randomFieldElement(),
    secret: randomFieldElement(),
    denomination,
  };
}

export function commitment(note: Note): bigint {
  return poseidon2([note.nullifier, note.secret]) % FIELD_SIZE;
}

export function nullifierHash(note: Note): bigint {
  return poseidon2([note.nullifier, 0n]) % FIELD_SIZE;
}

/** Portable backup string: `umbra-v3-<denom>-<nullifier>-<secret>` (hex). */
export function serializeNote(note: Note): string {
  return [
    "umbra-v3",
    note.denomination.toString(16),
    note.nullifier.toString(16),
    note.secret.toString(16),
  ].join("-");
}

export function parseNote(s: string): Note {
  const parts = s.trim().split("-");
  if (parts.length !== 5 || parts[0] !== "umbra" || parts[1] !== "v3") {
    throw new Error("invalid Umbra note string");
  }
  return {
    denomination: BigInt("0x" + parts[2]),
    nullifier: BigInt("0x" + parts[3]),
    secret: BigInt("0x" + parts[4]),
  };
}
