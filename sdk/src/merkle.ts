import { poseidon2 } from "poseidon-lite";
import { FIELD_SIZE, ZERO_VALUE, TREE_LEVELS } from "./field";

/**
 * Off-chain mirror of the on-chain incremental Merkle tree. Built from the ordered
 * list of leaf commitments emitted by Deposit events, it reproduces the same root the
 * contract holds and yields the authentication path a withdrawal proof needs.
 */
export interface MerklePath {
  root: bigint;
  pathElements: bigint[]; // length == levels
  pathIndices: number[]; // 0/1, length == levels
  leafIndex: number;
}

function hashLR(l: bigint, r: bigint): bigint {
  return poseidon2([l, r]) % FIELD_SIZE;
}

/** Precompute the "all-zeros subtree" hash for each level. */
function zeros(levels: number): bigint[] {
  const z: bigint[] = [ZERO_VALUE];
  for (let i = 1; i <= levels; i++) z.push(hashLR(z[i - 1], z[i - 1]));
  return z;
}

export class MerkleTree {
  levels: number;
  private layers: bigint[][]; // layers[0] = leaves
  private zeroHashes: bigint[];

  constructor(leaves: bigint[], levels: number = TREE_LEVELS) {
    this.levels = levels;
    this.zeroHashes = zeros(levels);
    this.layers = [leaves.slice()];
    this.build();
  }

  private build() {
    for (let level = 0; level < this.levels; level++) {
      const cur = this.layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const left = cur[i];
        const right = i + 1 < cur.length ? cur[i + 1] : this.zeroHashes[level];
        next.push(hashLR(left, right));
      }
      this.layers[level + 1] = next;
    }
  }

  root(): bigint {
    const top = this.layers[this.levels];
    return top.length ? top[0] : this.zeroHashes[this.levels];
  }

  proof(leafIndex: number): MerklePath {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = leafIndex;
    for (let level = 0; level < this.levels; level++) {
      const cur = this.layers[level];
      const isRight = idx % 2; // 1 => current node is right child
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      const sibling =
        siblingIndex < cur.length ? cur[siblingIndex] : this.zeroHashes[level];
      pathElements.push(sibling);
      pathIndices.push(isRight);
      idx = Math.floor(idx / 2);
    }
    return { root: this.root(), pathElements, pathIndices, leafIndex };
  }
}
