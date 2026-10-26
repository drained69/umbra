import { ethers } from "ethers";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ReviveProvider } from "@umbra/sdk";
import deployment from "../config/deployment.json";

/** Network presets (verified live). V3 Live = Portaldot mainnet V3.0: no EVM JSON-RPC. */
export const NETWORKS: Record<string, { network: string; chainId: number; rpc: string | null; substrateWs: string; nativeSymbol: string }> = {
  testnet: { network: "portaldot-v3-testnet", chainId: 420420777, rpc: "https://test-evm-rpc-v3.portaldot.dev", substrateWs: "wss://test-node-v3.portaldot.dev", nativeSymbol: "tPOT" },
  v3live: { network: "portaldot-v3-live", chainId: 780780777, rpc: null, substrateWs: "wss://live-v3-node.portaldot.dev", nativeSymbol: "POT" },
};

/** `?network=v3live` targets another network (e.g. to deploy there); otherwise deployment.json. */
function selectDeployment(): any {
  const want = typeof location !== "undefined" ? new URLSearchParams(location.search).get("network") : null;
  const preset = want ? NETWORKS[want] : null;
  const base = deployment as any;
  if (!preset || base.network === preset.network) {
    const known = Object.values(NETWORKS).find((n) => n.network === base.network);
    return { nativeSymbol: known?.nativeSymbol ?? "tPOT", ...base };
  }
  return { ...preset, decimals: 18, nativeDecimals: 14, deployBlock: 0, verifierMode: "onchain", treeLevels: 20, relayerFeeBps: 50, contracts: { pools: {}, tokens: {} } };
}

export const DEPLOYMENT = selectDeployment();
export const NATIVE = DEPLOYMENT.nativeSymbol as string;
/** Networks without an EVM JSON-RPC (V3 Live) are read through Portaldot's native APIs. */
export const HAS_EVM_RPC = !!DEPLOYMENT.rpc;
export const CHAIN_ID_HEX = "0x" + Number(DEPLOYMENT.chainId).toString(16);

export const PORTALDOT_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: DEPLOYMENT.network,
  // EVM layer exposes native POT with 18 decimals (pallet-revive nativeToEthRatio = 10^4)
  nativeCurrency: { name: "Test POT", symbol: "tPOT", decimals: 18 },
  rpcUrls: [DEPLOYMENT.rpc],
  blockExplorerUrls: ["https://node-console.portaldot.dev/"],
};

let apiPromise: Promise<ApiPromise> | null = null;
/** Native Substrate API (account mapping, native signing, balances). Lazily connected. */
export function getApi(): Promise<ApiPromise> {
  if (!apiPromise) {
    apiPromise = ApiPromise.create({ provider: new WsProvider(DEPLOYMENT.substrateWs), noInitWarn: true });
  }
  return apiPromise;
}

/**
 * Read access to the contracts (pool state, events, balances): the EVM JSON-RPC when the
 * network has one, otherwise ReviveProvider over Substrate RPC — verified to return results
 * identical to the EVM RPC (sdk/test/revive_provider_equivalence.ts).
 */
export const readProvider: ethers.Provider = HAS_EVM_RPC
  ? new ethers.JsonRpcProvider(DEPLOYMENT.rpc, Number(DEPLOYMENT.chainId), { staticNetwork: true })
  : new ReviveProvider(getApi, Number(DEPLOYMENT.chainId));

/**
 * Pools whose Groth16 proofs are verified in Portaldot's WASM VM (docs/CROSS_VM.md): the
 * ink! coprocessor runs the pairing check and the EVM bridge the pool trusts records it.
 */
export interface CrossVmConfig {
  coprocessor: string; // SS58 (pallet-contracts)
  coprocessorCodeHash: string;
  bridge: string;
  attestor: string; // the only EVM account the bridge accepts attestations from
  pools: Record<string, string>; // tPOT denomination -> pool
  deployBlock: number;
}
export const CROSS_VM: CrossVmConfig | null = DEPLOYMENT.crossVm ?? null;

export function isCrossVmPool(address: string | undefined): boolean {
  return !!CROSS_VM && !!address && Object.values(CROSS_VM.pools).some((p) => p.toLowerCase() === address.toLowerCase());
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
    { symbol: NATIVE, decimals: Number(DEPLOYMENT.decimals), token: ethers.ZeroAddress, assetId: null, pools: { ...(DEPLOYMENT.contracts.pools || {}), ...(CROSS_VM?.pools || {}) } },
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
