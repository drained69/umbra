/*
 * Cross-VM coprocessor checks (read-only; nothing is signed):
 *   - signal derivation and SCALE encoding match the pool, the circuit and ink! 5;
 *   - the WASM coprocessor instantiates on the live Portaldot V3 testnet (dry-run), and a
 *     malformed verifying key is reported as a revert;
 *   - after deployment (COPROCESSOR=<ss58>), the deployed contract accepts a real withdraw
 *     proof and rejects a tampered one — the pairing check running in the WASM VM.
 *
 *   cd sdk && npx --yes tsx@4.19.1 test/crossvm_live.ts
 */
import { readFileSync } from "node:fs";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import {
  dryRunCoprocessorInstantiate,
  encodeProofMessage,
  groth16Words,
  wasmCheck,
  wasmCodeHash,
  withdrawSignals,
  type CoprocessorArtifact,
} from "../src/index";

const WS = process.env.PORTALDOT_WS ?? "wss://test-node-v3.portaldot.dev";
const art: CoprocessorArtifact = JSON.parse(readFileSync(new URL("../artifacts/coprocessor.json", import.meta.url), "utf8"));
const fx = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/proof.json", import.meta.url), "utf8"));
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};

// --- offline: the proof as the pool hands it to its verifier
const signals = withdrawSignals(BigInt(fx.pub[0]), BigInt(fx.pub[1]), fx.meta.recipient, fx.meta.relayer, BigInt(fx.meta.fee), BigInt(fx.meta.refund));
check(signals.every((s, i) => s === BigInt(fx.pub[i])), "withdrawSignals() reproduces the circuit's public signals");
const words = groth16Words({ a: fx.aFlat, b: [[fx.bFlat[0], fx.bFlat[1]], [fx.bFlat[2], fx.bFlat[3]]], c: fx.cFlat }, signals);
check(words.b.every((w, i) => BigInt(w) === BigInt(fx.bFlat[i])), "G2 b stays in EVM precompile order");

const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
try {
  const msg = encodeProofMessage(api, art, "verify_or_revert", words);
  check(ethers.dataLength(msg) === 4 + 32 * 8 + 1 + 32 * 6, "verify_or_revert calldata: selector | a | b | c | Vec<6 words>");
  check(msg.startsWith(art.selectors.verify_or_revert), "selector comes from the ink! metadata");

  // --- live dry-runs (from the richest account, so the price is not limited by a balance)
  const entries = await api.query.system.account.entries();
  entries.sort((x: any, y: any) => (y[1].data.free.toBigInt() > x[1].data.free.toBigInt() ? 1 : -1));
  const rich = entries[0][0].args[0].toString();
  const dr = await dryRunCoprocessorInstantiate(api, rich, art);
  check(dr.ok && !!dr.address, `coprocessor instantiates on ${WS}`);
  console.log(`    deposit ${(Number(dr.deposit) / 1e14).toFixed(2)} tPOT · refTime ${(Number(dr.weight.refTime) / 1e12).toFixed(3)} s`);

  const bad = { ...art, withdrawVkWords: [ethers.zeroPadValue("0x01", 32), ...art.withdrawVkWords.slice(1)] }; // alpha.x off-curve
  const rejected = await dryRunCoprocessorInstantiate(api, rich, bad);
  check(rejected.reverted && !rejected.ok, "a malformed verifying key reverts the constructor");

  // --- after deployment: real WASM verification of a real proof
  const deployed = process.env.COPROCESSOR;
  if (deployed) {
    check((await wasmCodeHash(api, deployed)) === art.codeHash, "deployed coprocessor runs the pinned code");
    check(await wasmCheck(api, rich, deployed, art, words), "WASM VM accepts the real withdraw proof");
    const tampered = { ...words, inputs: [...words.inputs.slice(0, 4), ethers.zeroPadValue("0x01", 32), words.inputs[5]] };
    check(!(await wasmCheck(api, rich, deployed, art, tampered)), "WASM VM rejects a proof with a changed fee");
  } else {
    console.log("    (set COPROCESSOR=<ss58> after deploying to verify a real proof in the WASM VM)");
  }
} finally {
  await api.disconnect();
}
console.log(`\n${n} checks passed`);
