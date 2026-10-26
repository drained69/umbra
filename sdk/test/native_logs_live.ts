/*
 * Regression: deposits made from a native Portaldot account (revive.call, the Portaldot
 * Extension path) are invisible to the EVM RPC's eth_getLogs. HybridProvider must find them,
 * and its cache must make repeated scans fast. Read-only:
 *   cd sdk && npx --yes tsx@4.19.1 test/native_logs_live.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { HybridProvider, UmbraPoolClient } from "../src/index";

const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const WS = "wss://test-node-v3.portaldot.dev";
const CHAIN_ID = 420420777;
const POOL_100 = "0x9346d060Df4035d242c42FA5fcEC93b49F17e7Fb";
const DEPLOY_BLOCK = 169320;
const NATIVE_DEPOSIT_BLOCK = 179779; // a revive.call deposit from a native account
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};

let apiP: Promise<ApiPromise> | null = null;
const getApi = () => (apiP ??= ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true }));
try {
  const evm = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const evmLogs = await evm.getLogs({ address: POOL_100, fromBlock: NATIVE_DEPOSIT_BLOCK, toBlock: NATIVE_DEPOSIT_BLOCK });
  check(evmLogs.length === 0, "the EVM RPC does not return the native deposit's log (the bug this guards against)");

  const hybrid = new HybridProvider(RPC, CHAIN_ID, getApi);
  const nextIndex = Number(await new ethers.Contract(POOL_100, ["function nextIndex() view returns (uint32)"], hybrid).nextIndex());
  const t0 = Date.now();
  const deposits = await new UmbraPoolClient(POOL_100, hybrid, { deployBlock: DEPLOY_BLOCK, chunkSize: 1_000_000 }).scanDeposits();
  const first = (Date.now() - t0) / 1000;
  check(deposits.length === nextIndex, `HybridProvider finds every deposit the pool counts (${deposits.length} of ${nextIndex})`);
  check(deposits.some((d) => d.blockNumber === NATIVE_DEPOSIT_BLOCK), "including the native-account deposit");
  check(first < 20, `a full first scan is fast enough for the app (${first.toFixed(1)} s)`);

  const t1 = Date.now();
  const again = await new UmbraPoolClient(POOL_100, hybrid, { deployBlock: DEPLOY_BLOCK, chunkSize: 1_000_000 }).scanDeposits();
  const second = (Date.now() - t1) / 1000;
  check(again.length === deposits.length && second < first / 2, `repeat scans only fetch new blocks: ${first.toFixed(1)} s, then ${second.toFixed(1)} s`);
} finally {
  if (apiP) await (await apiP).disconnect();
}
console.log(`\n${n} checks passed`);
