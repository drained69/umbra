/*
 * Prices the multi-asset pool deployment on Portaldot V3 testnet with read-only dry-runs
 * (nothing is signed or sent):
 *   cd sdk && npx --yes tsx@4.19.1 test/multiasset_deploy_live.ts [native-account]
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assetErc20Address, dryRunInstantiate, planMultiAssetDeployment, type Bytecodes } from "../src/index";

const WS = "wss://test-node-v3.portaldot.dev";
const ROOT = join(import.meta.dirname, "..", "..");
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "testnet.json"), "utf8"));
const code = JSON.parse(readFileSync(join(ROOT, "sdk", "artifacts", "contracts.json"), "utf8")).contracts as Bytecodes;
const origin = process.argv[2] || dep.deployer.native;

const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
try {
  const steps = planMultiAssetDeployment(code, { poseidon: dep.contracts.poseidon, tokens: [assetErc20Address(7777)] });
  const addr: Record<string, string> = {};
  let total = 0n;
  for (const s of steps) {
    const dr = await dryRunInstantiate(api, origin, s.initcode(addr));
    if (!dr.ok) throw new Error(`${s.label}: ${dr.error}`);
    addr[s.id] = dr.address!;
    total += dr.deposit;
    console.log(`${s.label.padEnd(32)} deposit ${(Number(dr.deposit) / 1e14).toFixed(3)} tPOT`);
  }
  const free = BigInt(((await api.query.system.account(origin)) as any).data.free.toString());
  console.log(`total ${(Number(total) / 1e14).toFixed(3)} tPOT; ${origin} has ${(Number(free) / 1e14).toFixed(3)} tPOT`);
} finally {
  await api.disconnect();
}
