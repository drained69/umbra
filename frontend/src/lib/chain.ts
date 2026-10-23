import { ethers } from "ethers";
import { ApiPromise, WsProvider } from "@polkadot/api";
import deployment from "../config/deployment.json";

export const DEPLOYMENT = deployment as any;
export const CHAIN_ID_HEX = "0x" + Number(DEPLOYMENT.chainId).toString(16);

export const PORTALDOT_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Portaldot V3 Testnet",
  // EVM layer exposes native POT with 18 decimals (pallet-revive nativeToEthRatio = 10^4)
  nativeCurrency: { name: "Test POT", symbol: "tPOT", decimals: 18 },
  rpcUrls: [DEPLOYMENT.rpc],
  blockExplorerUrls: ["https://node-console.portaldot.dev/"],
};

/** Read-only EVM access (no wallet needed): pool state, events, balances. */
export const readProvider = new ethers.JsonRpcProvider(DEPLOYMENT.rpc, Number(DEPLOYMENT.chainId), {
  staticNetwork: true,
});

let apiPromise: Promise<ApiPromise> | null = null;
/** Native Substrate API (account mapping, native signing, balances). Lazily connected. */
export function getApi(): Promise<ApiPromise> {
  if (!apiPromise) {
    apiPromise = ApiPromise.create({ provider: new WsProvider(DEPLOYMENT.substrateWs), noInitWarn: true });
  }
  return apiPromise;
}

/** Shieldable assets on this deployment: native tPOT plus Portaldot assets (pUSD…). */
export interface AssetInfo {
  symbol: string;
  decimals: number;
  token: string; // address(0) for native
  assetId: number | null;
  pools: Record<string, string>; // denomination label -> pool
  rules?: { sufficient: boolean; minBalance: bigint };
}

export function assets(): AssetInfo[] {
  const out: AssetInfo[] = [
    { symbol: "tPOT", decimals: Number(DEPLOYMENT.decimals), token: ethers.ZeroAddress, assetId: null, pools: DEPLOYMENT.contracts.pools || {} },
  ];
  for (const [symbol, t] of Object.entries<any>(DEPLOYMENT.contracts.tokens || {})) {
    out.push({
      symbol,
      decimals: t.decimals,
      token: t.address,
      assetId: t.assetId,
      pools: t.pools,
      rules: { sufficient: !!t.sufficient, minBalance: BigInt(t.minBalance ?? 0) },
    });
  }
  return out.filter((a) => Object.keys(a.pools).length > 0);
}

export function format(amount: bigint, decimals: number): string {
  return ethers.formatUnits(amount, decimals);
}
export function parse(amount: string, decimals: number): bigint {
  return ethers.parseUnits(amount, decimals);
}

export function short(addr: string): string {
  return addr.length > 14 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
}

/** Link to a native block in the Portaldot node console (polkadot.js Apps). */
export function blockLink(blockHash: string): string {
  return `https://node-console.portaldot.dev/?rpc=${encodeURIComponent(DEPLOYMENT.substrateWs)}#/explorer/query/${blockHash}`;
}

export const PORTALDOT_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/portaldot-extension/cpdecangbhmfijmlmjglfcocfpaojceo";
