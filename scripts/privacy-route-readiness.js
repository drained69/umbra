#!/usr/bin/env node
/** Read-only evidence check for the proposed Sepolia ↔ Portaldot privacy routes. */
import { ethers } from "ethers";

const PORTALDOT_CHAIN_ID = 420420777;
const SEPOLIA_CHAIN_ID = 11155111;
const PORTALDOT_RPC = process.env.PORTALDOT_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "";
const FACTORY = process.env.PORTALDOT_SWAP_FACTORY || "0xc631805c297c4233b33c30af91245058902c1d18";
const WPOT = process.env.PORTALDOT_WPOT || "0xf67ce92096e4e171060b71bf0cca0da9f9548c03";
const PUSDT = process.env.PORTALDOT_PUSDT || "0xe0114adc0a2072b602c645f5a07eefa1eadbdbc2";
const PUSD = "0x00001E6100000000000000000000000000010000"; // asset #7777; distinct from pUSDT
const PORTALDOT_BRIDGE = process.env.PORTALDOT_BRIDGE || "";
const SEPOLIA_BRIDGE = process.env.SEPOLIA_BRIDGE || "";

function provider(url, chainId) {
  const request = new ethers.FetchRequest(url);
  request.timeout = 10_000;
  return new ethers.JsonRpcProvider(request, chainId, { staticNetwork: true });
}

async function inspectChain(url, chainId, bridge) {
  if (!url) return { checked: false, reason: "RPC not configured" };
  try {
    const p = provider(url, chainId);
    const actual = Number(await p.send("eth_chainId", []));
    if (actual !== chainId) return { checked: true, chainId: actual, bridgeReady: false, reason: `expected chain ${chainId}` };
    if (!bridge || !ethers.isAddress(bridge)) return { checked: true, chainId: actual, bridgeReady: false, reason: "bridge adapter address not configured" };
    const code = await p.getCode(bridge);
    return { checked: true, chainId: actual, bridgeAddress: bridge, bridgeReady: code !== "0x", reason: code === "0x" ? "bridge address has no code" : "code exists; bridge behavior and trust model still need verification" };
  } catch (error) {
    return { checked: false, bridgeReady: false, reason: "RPC unavailable or timed out", errorCode: error?.code || "UNKNOWN" };
  }
}

async function inspectSwap(asset, label) {
  try {
    const p = provider(PORTALDOT_RPC, PORTALDOT_CHAIN_ID);
    const chainId = Number(await p.send("eth_chainId", []));
    if (chainId !== PORTALDOT_CHAIN_ID) return { ready: false, reason: `wrong chain ${chainId}` };
    if ((await p.getCode(FACTORY)) === "0x") return { ready: false, reason: "factory has no code" };
    const factory = new ethers.Contract(FACTORY, ["function getPair(address,address) view returns (address)"], p);
    const pairAddress = await factory.getPair(WPOT, asset);
    if (pairAddress === ethers.ZeroAddress) return { ready: false, factory: FACTORY, pair: null, reason: `no WPOT/${label} pair` };
    const pair = new ethers.Contract(pairAddress, ["function token0() view returns (address)", "function token1() view returns (address)", "function getReserves() view returns (uint112,uint112,uint32)"], p);
    const [token0, token1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
    const validTokens = [token0.toLowerCase(), token1.toLowerCase()].sort().join() === [WPOT.toLowerCase(), asset.toLowerCase()].sort().join();
    const nonzero = reserves[0] > 0n && reserves[1] > 0n;
    return {
      ready: false, // Nonzero reserves alone never verify router provenance, quote quality, or executable liquidity.
      pair: pairAddress,
      validTokens,
      reserves: [reserves[0].toString(), reserves[1].toString()],
      reason: !validTokens ? "pair tokens mismatch" : !nonzero ? "pair has zero reserves" : "liquidity observed; verify factory/router provenance, quotes, and executable route",
    };
  } catch (error) {
    return { ready: false, reason: "Portaldot RPC or swap contracts unavailable", errorCode: error?.code || "UNKNOWN" };
  }
}

const [portaldot, sepolia, swap, futurePusdSwap] = await Promise.all([
  inspectChain(PORTALDOT_RPC, PORTALDOT_CHAIN_ID, PORTALDOT_BRIDGE),
  inspectChain(SEPOLIA_RPC, SEPOLIA_CHAIN_ID, SEPOLIA_BRIDGE),
  inspectSwap(PUSDT, "pUSDT"),
  inspectSwap(PUSD, "pUSD"),
]);
const result = {
  checkedAt: new Date().toISOString(),
  route: "Ethereum Sepolia ↔ Portaldot V3 testnet",
  swapPair: "WPOT ↔ pUSDT",
  futureSwapPair: "WPOT ↔ pUSD asset #7777",
  portaldot,
  sepolia,
  swap,
  futurePusdSwap,
  crossChainReady: false, // Code presence is not evidence of a verified bridge or finalized messages.
  privateSwapReady: false, // Requires a multiasset vault, settlement proof, and verified liquidity.
};
console.log(JSON.stringify(result, null, 2));
