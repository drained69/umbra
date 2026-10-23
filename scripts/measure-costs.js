#!/usr/bin/env node
/*
 * Measure real per-operation costs of Umbra on a Portaldot network (READ-ONLY).
 * Dry-run-instantiates contracts/test/harness/CostHarness.sol (which deploys the real
 * Poseidon + pools and performs N operations in its constructor) from a funded account,
 * then differences runs to isolate each operation's fee and storage deposit.
 * Nothing is signed or submitted.
 *
 *   NETWORK=testnet node scripts/measure-costs.js
 *   MEASURE_ORIGIN=5... to choose the (funded) dry-run origin; default = richest of a sample.
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { poseidonContract } from "circomlibjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "contracts", "out");
const net = JSON.parse(readFileSync(join(__dirname, "networks.json"), "utf8"))[(process.env.NETWORK || "testnet").toLowerCase()];
const art = (n) => JSON.parse(readFileSync(join(OUT, `${n}.sol`, `${n}.json`), "utf8"));
const coder = ethers.AbiCoder.defaultAbiCoder();
const POSEIDON = ethers.hexlify(poseidonContract.createCode(2));
const harness = (mode, deposits, withdrawals) =>
  ethers.concat([art("CostHarness").bytecode.object, coder.encode(["bytes", "uint8", "uint256", "uint256"], [POSEIDON, mode, deposits, withdrawals])]);

const api = await ApiPromise.create({ provider: new WsProvider(net.substrateWs), noInitWarn: true });
let origin = process.env.MEASURE_ORIGIN;
if (!origin) {
  const entries = await api.query.system.account.entries();
  origin = entries.sort((a, b) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();
}
const tpot = (x) => (Number(x) / 1e14).toFixed(3);

async function run(label, mode, d, w) {
  const code = harness(mode, d, w);
  const value = 10n ** 14n * BigInt(d + 1); // planck; covers d deposits of 1 tPOT
  const r = await api.call.reviveApi.instantiate(origin, value, null, null, { Upload: code }, "0x", null);
  if (r.result.isErr) {
    const e = r.result.asErr;
    const m = e.isModule ? api.registry.findMetaError(e.asModule) : null;
    throw new Error(`${label}: ${m ? m.section + "." + m.name : e.toString()}`);
  }
  if (r.result.asOk.result.flags.bits.toNumber() & 1) throw new Error(`${label}: constructor reverted`);
  const deposit = [r.storageDeposit, r.maxStorageDeposit].map((x) => (x.isCharge ? x.asCharge.toBigInt() : 0n)).reduce((a, b) => (a > b ? a : b));
  const w8 = r.weightRequired;
  const fee = (await api.call.transactionPaymentApi.queryWeightToFee({ refTime: w8.refTime, proofSize: w8.proofSize })).toBigInt();
  return { deposit, fee };
}

console.log(`Network ${(await api.rpc.system.chain()).toString()} — dry-run origin ${origin.slice(0, 8)}… (read-only)\n`);
const N = 3;
const f0 = await run("fixed base", 0, 0, 0);
const fd = await run("fixed +deposits", 0, N, 0);
const fw = await run("fixed +withdrawals", 0, N, N);
const j0 = await run("join-split base", 1, 0, 0);
const jd = await run("join-split +tx", 1, N, 0);
const jt = await run("join-split +transfers", 1, N, N);

const per = (a, b) => ({ deposit: (b.deposit - a.deposit) / BigInt(N), fee: (b.fee - a.fee) / BigInt(N) });
const rows = [
  ["fixed pool: deposit", per(f0, fd)],
  ["fixed pool: withdraw", per(fd, fw)],
  ["join-split: deposit (transact)", per(j0, jd)],
  ["join-split: private transfer", per(jd, jt)],
];
console.log("operation".padEnd(34), "storage deposit".padStart(16), "exec fee*".padStart(12));
for (const [label, c] of rows) console.log(label.padEnd(34), (tpot(c.deposit) + " tPOT").padStart(16), (tpot(c.fee) + " tPOT").padStart(12));
console.log(`\nbase (Poseidon + pool + mock verifier code + init): fixed ${tpot(f0.deposit)} tPOT, join-split ${tpot(j0.deposit)} tPOT deposit`);
console.log("* weight fee only (excludes the per-extrinsic base/length fee)");
await api.disconnect();
process.exit(0);
