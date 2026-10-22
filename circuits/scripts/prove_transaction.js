#!/usr/bin/env node
/*
 * End-to-end join-split proof (pure deposit: 2 dummy inputs -> 2 real outputs).
 * Proves the transaction circuit + setup are consistent, and emits the on-chain fixture
 * contracts/test/fixtures/tx_proof.json for TransactionVerifier.t.sol.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");
const { AbiCoder, keccak256 } = require("ethers");

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE =
  17003957365552116588566697242255183877916613397757664392656876041027752888120n;
const LEVELS = 20;

const BUILD = path.join(__dirname, "..", "build");
const WASM = path.join(BUILD, "transaction_js", "transaction.wasm");
const ZKEY = path.join(BUILD, "transaction_final.zkey");
const VKEY = JSON.parse(fs.readFileSync(path.join(BUILD, "transaction_verification_key.json")));

const rand = () => BigInt("0x" + crypto.randomBytes(31).toString("hex")) % FIELD;

function emptyRoot() {
  let cur = ZERO_VALUE;
  for (let i = 0; i < LEVELS; i++) cur = poseidon2([cur, cur]) % FIELD;
  return cur;
}

function dummyInput() {
  const priv = rand();
  const pub = poseidon1([priv]) % FIELD;
  const blinding = rand();
  const amount = 0n;
  const commitment = poseidon3([amount, pub, blinding]) % FIELD;
  const idx = 0n;
  const sig = poseidon3([priv, commitment, idx]) % FIELD;
  const nullifier = poseidon3([commitment, idx, sig]) % FIELD;
  return { priv, pub, blinding, amount, nullifier };
}

function output(amount) {
  const priv = rand();
  const pub = poseidon1([priv]) % FIELD;
  const blinding = rand();
  const commitment = poseidon3([amount, pub, blinding]) % FIELD;
  return { priv, pub, blinding, amount, commitment };
}

async function main() {
  const DEP = 100n;
  const ins = [dummyInput(), dummyInput()];
  const outs = [output(70n), output(30n)];
  const root = emptyRoot();
  const publicAmount = DEP; // extAmount=DEP, fee=0

  const extAmount = DEP;
  const fee = 0n;
  const recipient = "0x0000000000000000000000000000000000000000";
  const relayer = "0x0000000000000000000000000000000000000000";
  // == Solidity abi.encode(ExtData struct): dynamic tuple, not a flat list
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["tuple(address,int256,address,uint256,bytes,bytes)"],
    [[recipient, extAmount, relayer, fee, "0x", "0x"]]
  );
  const edHash = BigInt(keccak256(encoded)) % FIELD;

  const input = {
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: edHash.toString(),
    inputNullifier: ins.map((i) => i.nullifier.toString()),
    inAmount: ins.map((i) => i.amount.toString()),
    inPrivateKey: ins.map((i) => i.priv.toString()),
    inBlinding: ins.map((i) => i.blinding.toString()),
    inPathIndices: ["0", "0"],
    inPathElements: [new Array(LEVELS).fill("0"), new Array(LEVELS).fill("0")],
    outputCommitment: outs.map((o) => o.commitment.toString()),
    outAmount: outs.map((o) => o.amount.toString()),
    outPubkey: outs.map((o) => o.pub.toString()),
    outBlinding: outs.map((o) => o.blinding.toString()),
  };

  console.log("proving join-split (deposit)...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ok = await snarkjs.groth16.verify(VKEY, publicSignals, proof);
  if (!ok) throw new Error("JS verification FAILED");
  console.log("JS groth16 verify (transaction): OK");

  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]],
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  const fixture = {
    aFlat: a,
    bFlat: [b[0][0], b[0][1], b[1][0], b[1][1]],
    cFlat: c,
    pub: publicSignals, // [root, publicAmount, extDataHash, inNull0, inNull1, outCmt0, outCmt1]
  };
  const outDir = path.join(__dirname, "..", "..", "contracts", "test", "fixtures");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "tx_proof.json"), JSON.stringify(fixture, null, 2));
  console.log("wrote contracts/test/fixtures/tx_proof.json");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
