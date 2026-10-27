import { useEffect, useState } from "react";
import { ethers } from "ethers";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import {
  ERC20_ABI,
  MULTI_ASSET_POOL_ABI,
  UmbraMultiAssetClient,
  buildReviveCall,
  getMultiAssetRelayerQuote,
  relayMultiAsset,
  sendNative,
  type MultiAssetPlan,
  type MultiAssetRelayerQuote,
  type PreparedMultiAsset,
  type RelayTerms,
  type RequestAsset,
} from "@umbra/sdk";
import { DEPLOYMENT, RELAYER_URL, SCAN_CHUNK, blockLink, getApi, readProvider, short } from "./chain";
import type { TxRef } from "./shielded";
import type { Wallet } from "./wallet";

/**
 * The multi-asset private balance (tPOT + pUSD in one pool) with private swaps. Present once
 * `contracts.multiAssetPool` is in the deployment; until then the app uses the single-asset pool.
 */
export interface MultiAssetInfo {
  address: string;
  assets: { id: number; symbol: string; address: string | null; assetId?: number | null; decimals: number }[];
}
export const MA: MultiAssetInfo | null = (DEPLOYMENT.contracts as any).multiAssetPool ?? null;
export const MA_ARTIFACTS = { wasm: "/zk/multiasset.wasm", zkey: "/zk/multiasset_final.zkey" };
export const MA_NATIVE = 0n;

export const maClient = MA ? new UmbraMultiAssetClient(MA.address, readProvider, { deployBlock: DEPLOYMENT.deployBlock ?? 0, chunkSize: SCAN_CHUNK }) : null;

/**
 * Multi-asset pool id for a payment asset: tPOT is 0, a token is its position in the pool's
 * asset table. null when the asset can't be held privately on this network.
 */
export function maIdFor(asset: RequestAsset): bigint | null {
  if (asset.assetId === null) return 0n;
  const a = MA?.assets.find((x) => x.assetId === asset.assetId);
  return a ? BigInt(a.id) : null;
}

export function maAsset(id: bigint | number) {
  const a = MA?.assets.find((x) => x.id === Number(id));
  if (!a) throw new Error("unknown asset");
  return a;
}

let cached: Promise<MultiAssetRelayerQuote> | null = null;
export function maRelayerQuote(): Promise<MultiAssetRelayerQuote> {
  if (!MA) return Promise.reject(new Error("This network has no multi-asset private pool."));
  if (!RELAYER_URL) return Promise.reject(new Error("No relayer is configured for this app."));
  cached ??= getMultiAssetRelayerQuote(RELAYER_URL, { chainId: DEPLOYMENT.chainId, pool: MA.address });
  cached.catch(() => { cached = null; });
  return cached;
}

export type MaRelayerState = { state: "loading" } | { state: "ready"; quote: MultiAssetRelayerQuote } | { state: "down"; error: string };
export function useMaRelayer(): MaRelayerState {
  const [s, setS] = useState<MaRelayerState>({ state: "loading" });
  useEffect(() => {
    let stop = false;
    maRelayerQuote().then(
      (quote) => { if (!stop) setS({ state: "ready", quote }); },
      (e) => { if (!stop) setS({ state: "down", error: e?.message || String(e) }); }
    );
    return () => { stop = true; };
  }, []);
  return s;
}

export function proveMulti(plan: MultiAssetPlan): Promise<PreparedMultiAsset> {
  return maClient!.prepare(plan, MA_ARTIFACTS);
}

/**
 * Spend from the multi-asset private balance. The relayer submits it by default (no wallet
 * signs); `selfSubmit` signs with that wallet instead, which reveals the account.
 */
export async function spendMulti(
  asset: bigint,
  build: (relay?: RelayTerms) => Promise<MultiAssetPlan>,
  onStatus: (m: string) => void,
  opts: { selfSubmit?: Wallet | null } = {}
): Promise<TxRef> {
  if (opts.selfSubmit) {
    const plan = await build();
    onStatus("Generating a zero-knowledge proof in your browser…");
    return submitMultiWithWallet(opts.selfSubmit, await proveMulti(plan), onStatus);
  }
  onStatus("Contacting the relayer…");
  const quote = await maRelayerQuote();
  const plan = await build({ relayer: quote.relayer, fee: quote.fees[Number(asset)] });
  onStatus("Generating a zero-knowledge proof in your browser…");
  const prepared = await proveMulti(plan);
  onStatus("The relayer is submitting it. Nothing for your wallet to sign…");
  const r = await relayMultiAsset(quote, prepared);
  return { label: `relayed · block ${short(r.blockHash)}`, href: blockLink(r.blockHash) };
}

const POOL = new ethers.Interface(MULTI_ASSET_POOL_ABI);
const ERC20 = new ethers.Interface(ERC20_ABI);

/**
 * The calls a native account makes to submit a prepared transaction itself: an ERC-20
 * approval first for a token deposit, then the pool call (one batch, one signature).
 */
export async function multiCalls(account: string, prepared: PreparedMultiAsset, opts: { dependsOnEarlierCalls?: boolean } = {}): Promise<SubmittableExtrinsic<"promise">[]> {
  const api = await getApi();
  const [args, extData] = UmbraMultiAssetClient.encodeArgs(prepared.proof, prepared.ext);
  const calls: SubmittableExtrinsic<"promise">[] = [];
  const asset = maAsset(prepared.proof.multi!.publicAsset);
  const tokenDeposit = prepared.ext.extAmount > 0n && asset.address !== null;
  if (tokenDeposit) {
    calls.push(await buildReviveCall(api, account, asset.address!, ERC20.encodeFunctionData("approve", [MA!.address, prepared.ext.extAmount]), 0n, { abi: ERC20_ABI }));
  }
  const dependent = opts.dependsOnEarlierCalls || tokenDeposit;
  calls.push(
    await buildReviveCall(api, account, MA!.address, POOL.encodeFunctionData("transact", [args, extData]), UmbraMultiAssetClient.valueFor(prepared.proof, prepared.ext), {
      abi: MULTI_ASSET_POOL_ABI,
      fallbackWeight: dependent ? { refTime: 300_000_000_000n, proofSize: 2_000_000n } : undefined,
      fallbackDeposit: 12n * 10n ** 14n, // two nullifier slots: 7.68 tPOT measured
    })
  );
  return calls;
}

/** Submit a prepared transaction with the connected wallet (deposits, or an explicit opt-out of the relayer). */
export async function submitMultiWithWallet(wallet: Wallet, prepared: PreparedMultiAsset, onStatus: (m: string) => void): Promise<TxRef> {
  if (wallet.kind === "evm") {
    const asset = maAsset(prepared.proof.multi!.publicAsset);
    if (prepared.ext.extAmount > 0n && asset.address !== null) {
      onStatus("Approve the token in your wallet…");
      await (await new ethers.Contract(asset.address, ERC20_ABI, wallet.signer).approve(MA!.address, prepared.ext.extAmount)).wait();
    }
    const [args, extData] = UmbraMultiAssetClient.encodeArgs(prepared.proof, prepared.ext);
    onStatus("Confirm the transaction in your wallet…");
    const tx = await new ethers.Contract(MA!.address, MULTI_ASSET_POOL_ABI, wallet.signer).transact(args, extData, { value: UmbraMultiAssetClient.valueFor(prepared.proof, prepared.ext) });
    const receipt = await tx.wait();
    return { label: `EVM tx ${short(receipt.hash)}`, href: blockLink(receipt.blockHash) };
  }
  const calls = await multiCalls(wallet.account, prepared);
  onStatus("Sign the transaction in the Portaldot Extension…");
  const r = await sendNative(await getApi(), wallet.account, calls, { signer: wallet.signer });
  return { label: `block ${short(r.blockHash)}`, href: blockLink(r.blockHash) };
}
