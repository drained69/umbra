/*
 * ReviveProvider (native Substrate APIs) must answer exactly like the official EVM JSON-RPC.
 * Testnet has BOTH, so we compare them on identical queries (read-only):
 *   npx tsx sdk/test/revive_provider_equivalence.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { ReviveProvider, ERC20_ABI, assetErc20Address } from "../src/index";

const EVM_RPC = "https://test-evm-rpc-v3.portaldot.dev";
const WS = "wss://test-node-v3.portaldot.dev";
const CHAIN_ID = 420420777;
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};

let apiP: Promise<ApiPromise> | null = null;
const getApi = () => (apiP ??= ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true }));
const evm = new ethers.JsonRpcProvider(EVM_RPC, CHAIN_ID, { staticNetwork: true });
const nat = new ReviveProvider(getApi, CHAIN_ID);

const head = Math.min(await evm.getBlockNumber(), await nat.getBlockNumber());
const from = head - 2000;
console.log(`Comparing native provider vs EVM RPC on blocks ${from}..${head}`);

check(Math.abs((await evm.getBlockNumber()) - (await nat.getBlockNumber())) <= 3, "block numbers agree (±3)");
check(Number((await nat.getNetwork()).chainId) === CHAIN_ID, "chain id");

// logs: all logs in range, grouped per contract
const norm = (ls: ethers.Log[]) => ls.map((l) => `${l.blockNumber}|${l.address.toLowerCase()}|${l.topics.join(",")}|${l.data}`).sort();
const allEvm = await evm.getLogs({ fromBlock: from, toBlock: head });
const t0 = Date.now();
const allNat = await nat.getLogs({ fromBlock: from, toBlock: head });
const ms = Date.now() - t0;
check(allEvm.length > 0, `range has real logs (${allEvm.length})`);
check(JSON.stringify(norm(allEvm)) === JSON.stringify(norm(allNat)), `ALL ${allNat.length} logs identical (address, block, topics, data) — native scan took ${ms} ms for 2000 blocks`);

const addrs = [...new Set(allEvm.map((l) => l.address))];
for (const a of addrs) {
  const e = await evm.getLogs({ address: a, fromBlock: from, toBlock: head });
  const v = await nat.getLogs({ address: a, fromBlock: from, toBlock: head });
  check(JSON.stringify(norm(e)) === JSON.stringify(norm(v)), `address filter ${a.slice(0, 10)}…: ${v.length} logs identical`);
}
const topic0 = allEvm[0].topics[0];
const te = await evm.getLogs({ topics: [topic0], fromBlock: from, toBlock: head });
const tv = await nat.getLogs({ topics: [topic0], fromBlock: from, toBlock: head });
check(JSON.stringify(norm(te)) === JSON.stringify(norm(tv)), `topic filter: ${tv.length} logs identical`);

// calls through ethers Contracts
const pusd = assetErc20Address(7777);
const ce = new ethers.Contract(pusd, ERC20_ABI, evm);
const cv = new ethers.Contract(pusd, ERC20_ABI, nat);
check((await ce.decimals()) === (await cv.decimals()), "contract call: pUSD.decimals()");
check((await ce.symbol()) === (await cv.symbol()), `contract call: pUSD.symbol() = ${await cv.symbol()}`);
const holder = allEvm.find((l) => l.address.toLowerCase() === pusd.toLowerCase());
if (holder) {
  const who = ethers.getAddress("0x" + holder.topics[2].slice(26));
  check((await ce.balanceOf(who)) === (await cv.balanceOf(who)), "contract call: pUSD.balanceOf(recent recipient)");
}

// reverts surface the same way
const bad = new ethers.Contract(pusd, ["function transfer(address,uint256) returns (bool)"], nat);
let reverted = false;
try {
  await bad.transfer.staticCall(ethers.ZeroAddress, 10n ** 40n, { from: "0x000000000000000000000000000000000000dEaD" });
} catch (e: any) {
  reverted = e.code === "CALL_EXCEPTION";
}
check(reverted, "failing call surfaces as CALL_EXCEPTION");

// balances (same block-ish)
const someone = allEvm[0].topics.length > 1 ? ethers.getAddress("0x" + allEvm[0].topics[1].slice(26)) : ethers.ZeroAddress;
const [be, bv] = await Promise.all([evm.getBalance(someone), nat.getBalance(someone)]);
check(be === bv, `getBalance(${someone.slice(0, 10)}…) identical (${ethers.formatUnits(bv, 18)} tPOT)`);

await (await getApi()).disconnect();
console.log(`\nREVIVE PROVIDER EQUIVALENCE PASSED: ${n} checks`);
process.exit(0);
