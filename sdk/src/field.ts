// BN254 scalar field helpers. Must stay consistent with the circom circuit and the
// on-chain MerkleTreeWithHistory (FIELD_SIZE, ZERO_VALUE).

export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Matches MerkleTreeWithHistory.ZERO_VALUE exactly. Empty-leaf subtree seed.
export const ZERO_VALUE =
  8902741811979956579364953694938829634548534456828480688979151052822285834256n;

export const TREE_LEVELS = 20;

/** Cryptographically-random field element in [0, FIELD_SIZE). */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % FIELD_SIZE;
}

export function toHex32(x: bigint): string {
  return "0x" + x.toString(16).padStart(64, "0");
}
