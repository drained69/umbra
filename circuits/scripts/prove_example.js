#!/usr/bin/env node
/*
 * End-to-end ZK sanity check (pure JS):
 *   1. make a note, compute commitment = Poseidon(nullifier, secret)   [poseidon-lite]
 *   2. build the Merkle tree with that leaf, extract the auth path
 *   3. generate a Groth16 proof (snarkjs fullProve, real wasm+zkey)
 *   4. verify the proof against the exported verification key
 *   5. emit contracts/test/fixtures/proof.json for the on-chain verifier test
 *
 * If this prints OK and writes the fixture, the circuit, the trusted setup, and the
 * SDK note/merkle math are all mutually consistent.
 */
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const { poseidon2 } = require("poseidon-lite");

const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE =
  17003957365552116588566697242255183877916613397757664392656876041027752888120n;
const LEVELS = 20;

const BUILD = path.join(__dirname, "..", "build");
const WASM = path.join(BUILD, "withdraw_js", "withdraw.wasm");
const ZKEY = path.join(BUILD, "withdraw_final.zkey");
const VKEY = JSON.parse(fs.readFileSync(path.join(BUILD, "withdraw_verification_key.json")));

function rand() {
  const b = require("crypto").randomBytes(32);
  return BigInt("0x" + b.toString("hex")) % FIELD_SIZE;
}
const H = (l, r) => poseidon2([l, r]) % FIELD_SIZE;

function zeros() {
  const z = [ZERO_VALUE];
  for (let i = 1; i <= LEVELS; i++) z.push(H(z[i - 1], z[i - 1]));
  return z;
}

function buildTree(leaves) {
  const zs = zeros();
  const layers = [leaves.slice()];
  for (let lvl = 0; lvl < LEVELS; lvl++) {
    const cur = layers[lvl];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const left = cur[i];
      const right = i + 1 < cur.length ? cur[i + 1] : zs[lvl];
      next.push(H(left, right));
    }
    layers[lvl + 1] = next;
  }
  return { layers, zs };
}

function proofPath(layers, zs, leafIndex) {
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;
  for (let lvl = 0; lvl < LEVELS; lvl++) {
    const cur = layers[lvl];
    const isRight = idx % 2;
    const sib = isRight ? idx - 1 : idx + 1;
    pathElements.push(sib < cur.length ? cur[sib] : zs[lvl]);
    pathIndices.push(isRight);
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

async function main() {
  const nullifier = rand();
  const secret = rand();
  const commitment = H(nullifier, secret);
  const nullifierHash = H(nullifier, 0n);

  // a few decoy leaves so the proven index isn't 0 (realistic anonymity set)
  const leaves = [rand(), rand(), commitment, rand()];
  const leafIndex = 2;
  const { layers, zs } = buildTree(leaves);
  const root = layers[LEVELS][0];
  const { pathElements, pathIndices } = proofPath(layers, zs, leafIndex);

  const recipient = "0x1111111111111111111111111111111111111111";
  const relayer = "0x2222222222222222222222222222222222222222";
  const fee = 0n;
  const refund = 0n;

  const input = {
    root: root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    relayer: BigInt(relayer).toString(),
    fee: fee.toString(),
    refund: refund.toString(),
    nullifier: nullifier.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };

  console.log("proving...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
  if (!ok) throw new Error("JS verification FAILED");
  console.log("JS groth16 verify: OK");

  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  const fixture = {
    a,
    b,
    c,
    publicSignals, // [root, nullifierHash, recipient, relayer, fee, refund]
    // Flattened, quoted-decimal copies for trivial Foundry vm.parseJsonUintArray:
    aFlat: a,
    bFlat: [b[0][0], b[0][1], b[1][0], b[1][1]],
    cFlat: c,
    pub: publicSignals,
    meta: { recipient, relayer, fee: fee.toString(), refund: refund.toString() },
  };
  const outDir = path.join(__dirname, "..", "..", "contracts", "test", "fixtures");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify(fixture, null, 2));
  console.log("wrote contracts/test/fixtures/proof.json");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
