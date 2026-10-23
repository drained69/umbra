#!/usr/bin/env node
/*
 * Exact cost (READ-ONLY) of deploying Umbra on a Portaldot network: dry-run-instantiates
 * contracts/test/harness/DeployHarness.sol, which deploys the real Poseidon, verifiers and
 * pools from a funded account inside one simulation. Nothing is signed or submitted.
 *
 *   NETWORK=testnet node scripts/estimate-deploy.js
 *   NETWORK=v3live  node scripts/estimate-deploy.js
 *   DENOMINATIONS=100,1000   TOKEN_POOLS=7777:100,1000   SHIELDED=1   (same knobs as deploy.js)
 *   ESTIMATE_ORIGIN=5...     (funded dry-run origin; default: richest account)
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { poseidonContract } from "circomlibjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "contracts", "out");
const NETWORK = (process.env.NETWORK || "testnet").toLowerCase();
const net = JSON.parse(readFileSync(join(__dirname, "networks.json"), "utf8"))[NETWORK];
if (!net?.substrateWs) throw new Error(`no substrate endpoint for ${NETWORK}`);

const code = (n) => JSON.parse(readFileSync(join(OUT, `${n}.sol`, `${n}.json`), "utf8")).bytecode.object;
const DENOMS = (process.env.DENOMINATIONS || "100,1000").split(",").map((d) => ethers.parseUnits(d.trim(), 18));
const [tokenSpec] = (process.env.TOKEN_POOLS ?? "7777:100,1000").split(";").filter(Boolean);
const tokenId = tokenSpec ? BigInt(tokenSpec.split(":")[0]) : null;
const token = tokenId === null ? ethers.ZeroAddress : ethers.getAddress("0x" + tokenId.toString(16).padStart(8, "0") + "0".repeat(24) + "00010000");
const tokenDenoms = tokenSpec ? tokenSpec.split(":")[1].split(",").map((d) => ethers.parseUnits(d.trim(), 6)) : [];
const SHIELDED = process.env.SHIELDED !== "0";

const api = await ApiPromise.create({ provider: new WsProvider(net.substrateWs), noInitWarn: true });
let origin = process.env.ESTIMATE_ORIGIN;
if (!origin) {
  const entries = await api.query.system.account.entries();
  origin = entries.sort((a, b) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();
}
const sym = (await api.rpc.system.properties()).tokenSymbol.unwrap()[0].toString();
const fmt = (p) => (Number(p) / 1e14).toFixed(2);

async function price(label, args) {
  const init = ethers.concat([
    code("DeployHarness"),
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "uint256[]", "address", "uint256[]"],
      args
    ),
  ]);
  const r = await api.call.reviveApi.instantiate(origin, 0, null, null, { Upload: init }, "0x", null);
  if (r.result.isErr) {
    const e = r.result.asErr;
    const m = e.isModule ? api.registry.findMetaError(e.asModule) : null;
    throw new Error(`${label}: ${m ? m.section + "." + m.name : e.toString()}`);
  }
  if (r.result.asOk.result.flags.bits.toNumber() & 1) throw new Error(`${label}: harness reverted`);
  const deposit = [r.storageDeposit, r.maxStorageDeposit].map((x) => (x.isCharge ? x.asCharge.toBigInt() : 0n)).reduce((a, b) => (a > b ? a : b));
  const w = r.weightRequired;
  const ext = api.tx.revive.instantiateWithCode(0, { refTime: w.refTime, proofSize: w.proofSize }, deposit, init, "0x", null);
  const fee = (await ext.paymentInfo(origin)).partialFee.toBigInt();
  return { deposit, fee };
}

const P = ethers.hexlify(poseidonContract.createCode(2));
const WV = code("WithdrawVerifier"), TV = code("TransactionVerifier");
const POOL = code("UmbraPool"), TPOOL = code("UmbraTokenPool"), SP = code("UmbraShieldedPool");

console.log(`Network: ${(await api.rpc.system.chain()).toString()}  — dry-run origin ${origin.slice(0, 8)}… (read-only)\n`);
const empty = await price("harness only", ["0x", "0x", "0x", "0x", "0x", "0x", [], ethers.ZeroAddress, []].map((x, i) => (i === 0 ? P : i === 1 ? WV : x)));
const full = await price("full", [P, WV, TV, POOL, TPOOL, SHIELDED ? SP : "0x", DENOMS, token, tokenDenoms]);

console.log(`Configuration: tPOT pools [${DENOMS.map((d) => ethers.formatUnits(d, 18)).join(", ")}]` +
  (tokenDenoms.length ? `, asset ${tokenId} pools [${tokenDenoms.map((d) => ethers.formatUnits(d, 6)).join(", ")}]` : "") +
  (SHIELDED ? ", join-split pool" : ""));
console.log(`  core (Poseidon + withdraw verifier):  deposit ${fmt(empty.deposit)} ${sym}`);
console.log(`  full deployment:                      deposit ${fmt(full.deposit)} ${sym} + fees ~${fmt(full.fee)} ${sym}`);
const need = full.deposit + full.fee;
console.log(`\n→ Fund the deployer with at least ~${fmt((need * 12n) / 10n)} ${sym} (+20% headroom).`);
console.log("  Storage deposits stay locked with the contracts (refunded only if code/storage is removed).");
console.log("  Per-operation costs: deposit 0, withdrawal ~3.84 (nullifier slot), join-split ~7.68 — see measure-costs.js");
await api.disconnect();
process.exit(0);
