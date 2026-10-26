#!/usr/bin/env node
/*
 * Pin the ZK artifacts and the verifier contracts generated from them (audit H-03).
 *
 *   node circuits/scripts/manifest.js          # write sdk/artifacts/MANIFEST.json
 *   node circuits/scripts/manifest.js --check  # verify (CI): exit 1 on any mismatch
 *
 * A proving key and its Solidity verifier are a matched pair; if either changes without
 * the other, proofs stop verifying and deposited funds become unwithdrawable.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const FILES = [
  "sdk/artifacts/withdraw.wasm",
  "sdk/artifacts/withdraw_final.zkey",
  "sdk/artifacts/withdraw_verification_key.json",
  "sdk/artifacts/transaction.wasm",
  "sdk/artifacts/transaction_final.zkey",
  "sdk/artifacts/transaction_verification_key.json",
  "sdk/artifacts/multiasset.wasm",
  "sdk/artifacts/multiasset_final.zkey",
  "sdk/artifacts/multiasset_verification_key.json",
  "contracts/src/verifiers/WithdrawVerifier.sol",
  "contracts/src/verifiers/TransactionVerifier.sol",
  "contracts/src/verifiers/MultiAssetVerifier.sol",
  "sdk/artifacts/contracts.json",
  "sdk/artifacts/coprocessor.json",
];
const MANIFEST = path.join(ROOT, "sdk", "artifacts", "MANIFEST.json");

const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex");

if (process.argv.includes("--check")) {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  let bad = 0;
  for (const f of FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      console.error(`MISSING  ${f}`);
      bad++;
    } else if (m.files[f] !== sha256(f)) {
      console.error(`MISMATCH ${f}`);
      bad++;
    }
  }
  if (bad) {
    console.error(`\n${bad} artifact(s) out of sync — re-run \`make zk\` and commit ALL outputs together.`);
    process.exit(1);
  }
  console.log(`ZK artifacts OK (${FILES.length} files match MANIFEST.json, setup ${m.setup})`);
} else {
  const files = Object.fromEntries(FILES.map((f) => [f, sha256(f)]));
  const setup = process.env.PTAU_URL ? `ceremony:${process.env.PTAU_URL}` : "local-single-contributor (DEMO ONLY)";
  fs.writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), setup, files }, null, 2) + "\n");
  console.log(`wrote ${path.relative(ROOT, MANIFEST)}`);
}
