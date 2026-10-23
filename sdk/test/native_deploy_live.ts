/*
 * READ-ONLY validation of native deployment against Portaldot V3 testnet for a given account.
 * Nothing is signed. Usage:  DEPLOYER=5... npx tsx sdk/test/native_deploy_live.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { planDeployment, dryRunInstantiate, estimateDeployment, evmAddressOf, isMapped, type Bytecodes } from "../src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const code: Bytecodes = JSON.parse(readFileSync(join(__dirname, "..", "artifacts", "contracts.json"), "utf8")).contracts;
const DEPLOYER = process.env.DEPLOYER || "5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8";
const tpot = (p: bigint) => (Number(p) / 1e14).toFixed(2);

const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
const free = (await api.query.system.account(DEPLOYER) as any).data.free.toBigInt();
console.log(`Deployer ${DEPLOYER}`);
console.log(`  balance ${tpot(free)} tPOT · H160 ${await evmAddressOf(api, DEPLOYER)} · mapped ${await isMapped(api, DEPLOYER)}\n`);

const entries = await api.query.system.account.entries();
const rich = entries.sort((a: any, b: any) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();

const configs = {
  "minimal (100 tPOT pool)": { nativeDenoms: ["100"], shielded: false },
  "default (tPOT 100/1000 + pUSD 100/1000 + join-split)": {
    nativeDenoms: ["100", "1000"],
    token: { assetId: 7777, symbol: "pUSD", decimals: 6, denoms: ["100", "1000"] },
    shielded: true,
  },
};
for (const [label, cfg] of Object.entries(configs)) {
  const e = await estimateDeployment(api, DEPLOYER, code, cfg as any, rich);
  const need = e.deposit + e.fee;
  console.log(`${label}: ${tpot(e.deposit)} locked + ${tpot(e.fee)} fees = ${tpot(need)} tPOT → ${e.sufficientFunds ? "AFFORDABLE" : `short by ${tpot(need - free)} tPOT`}`);
}

console.log("\nPer-step dry-runs from the deployer (independent steps):");
const steps = planDeployment(code, { nativeDenoms: ["100"], shielded: false });
for (const s of steps.filter((s) => s.id === "poseidon" || s.id === "withdrawVerifier")) {
  const dr = await dryRunInstantiate(api, DEPLOYER, s.initcode({}));
  console.log(`  ${s.label.padEnd(30)} ${dr.ok ? `ok → would deploy at ${dr.address} (locks ${tpot(dr.deposit)} tPOT)` : `cannot yet: ${dr.error} (needs ~${tpot(dr.deposit)} tPOT)`}`);
  if (dr.ok) {
    const tx = api.tx.revive.instantiateWithCode(0, { refTime: dr.weight.refTime, proofSize: dr.weight.proofSize }, dr.deposit, s.initcode({}), "0x", null);
    console.log(`    extrinsic built: ${tx.method.section}.${tx.method.method}, fee ${tpot((await tx.paymentInfo(DEPLOYER)).partialFee.toBigInt())} tPOT`);
  }
}
await api.disconnect();
process.exit(0);
