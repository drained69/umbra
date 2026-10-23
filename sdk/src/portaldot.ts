// Portaldot-native integration layer.
//
// Everything here was verified against the live Portaldot V3 testnet runtime (spec
// `portaldot-v3`): pallet-revive with `nativeToEthRatio = 10000`, account mapping via
// `ReviveApi.address/accountId`, `revive.call` from native (sr25519/ed25519) accounts, and
// pallet-assets exposed to the EVM as ERC-20 precompiles. See docs/PORTALDOT_INTEGRATION.md.

import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { ethers } from "ethers";
import { NATIVE_TO_EVM_RATIO } from "./units";

// ---------------------------------------------------------------- assets as ERC-20s

/** Portaldot asset ERC-20 precompile:  0x{assetId:8 hex}{24 zero hex}00010000. */
export const ASSET_ERC20_SUFFIX = "00010000";

export function assetErc20Address(assetId: number | bigint): string {
  const id = BigInt(assetId);
  if (id < 0n || id > 0xffffffffn) throw new Error("asset id must be a u32");
  return ethers.getAddress("0x" + id.toString(16).padStart(8, "0") + "0".repeat(24) + ASSET_ERC20_SUFFIX);
}

export function assetIdFromErc20(address: string): bigint | null {
  const a = address.toLowerCase().replace(/^0x/, "");
  if (a.length !== 40 || a.slice(8, 32) !== "0".repeat(24) || a.slice(32) !== ASSET_ERC20_SUFFIX) return null;
  return BigInt("0x" + a.slice(0, 8));
}

export interface PortaldotAsset {
  id: bigint;
  symbol: string;
  name: string;
  decimals: number;
  erc20: string;
  supply: bigint;
}

/** All live pallet-assets with metadata and their EVM ERC-20 address. */
export async function listAssets(api: ApiPromise): Promise<PortaldotAsset[]> {
  const entries = await api.query.assets.asset.entries();
  const out: PortaldotAsset[] = [];
  for (const [key, value] of entries) {
    const id = BigInt(key.args[0].toString());
    const details = (value as any).unwrap?.() ?? value;
    if (details.status?.isLive === false) continue;
    const md: any = await api.query.assets.metadata(id);
    out.push({
      id,
      symbol: md.symbol.toUtf8(),
      name: md.name.toUtf8(),
      decimals: md.decimals.toNumber(),
      erc20: assetErc20Address(id),
      supply: BigInt(details.supply.toString()),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------- units

/** EVM value (18-dec wei) -> native planck (14-dec). Must be exact (no sub-planck dust). */
export function evmWeiToPlanck(wei: bigint): bigint {
  if (wei % NATIVE_TO_EVM_RATIO !== 0n) throw new Error("amount has sub-planck precision");
  return wei / NATIVE_TO_EVM_RATIO;
}

export function planckToEvmWei(planck: bigint): bigint {
  return planck * NATIVE_TO_EVM_RATIO;
}

// ---------------------------------------------------------------- accounts

/** The H160 that pallet-revive uses for a native account (what `msg.sender` will be). */
export async function evmAddressOf(api: ApiPromise, account: string): Promise<string> {
  return ethers.getAddress((await (api.call as any).reviveApi.address(account)).toString());
}

function sameAccount(api: ApiPromise, a: string, b: string): boolean {
  return api.createType("AccountId32", a).toHex() === api.createType("AccountId32", b).toHex();
}

/**
 * True if value sent to this account's H160 reaches the account itself. Holds for mapped
 * native accounts and for Ethereum-derived accounts (H160 ++ 0xEE*12). For an UNMAPPED
 * native account, the H160 resolves to a separate "fallback" account instead, so funds
 * sent there are not directly spendable — withdrawals must not target it (see SDK checks).
 */
export async function isMapped(api: ApiPromise, account: string): Promise<boolean> {
  const h160 = await evmAddressOf(api, account);
  const back = (await (api.call as any).reviveApi.accountId(h160)).toString();
  return sameAccount(api, back, account);
}

export interface RecipientResolution {
  evmAddress: string;
  kind: "evm" | "native";
  /** false => withdrawing here would strand funds until the native account maps itself */
  receivable: boolean;
  note?: string;
}

/** Accept either a 0x address or a Portaldot SS58 (5…) address as a withdrawal recipient. */
export async function resolveRecipient(api: ApiPromise, input: string): Promise<RecipientResolution> {
  const s = input.trim();
  if (ethers.isAddress(s)) return { evmAddress: ethers.getAddress(s), kind: "evm", receivable: true };
  let evmAddress: string;
  try {
    evmAddress = await evmAddressOf(api, s);
  } catch {
    throw new Error("not a valid 0x or Portaldot (SS58) address");
  }
  const mapped = await isMapped(api, s);
  return {
    evmAddress,
    kind: "native",
    receivable: mapped,
    note: mapped
      ? undefined
      : "This Portaldot account isn't mapped to the EVM yet. Funds sent now would land in its fallback account. Have it send one `revive.mapAccount()` transaction first (Umbra does this automatically on that account's first deposit).",
  };
}

// ---------------------------------------------------------------- calling EVM contracts natively

export interface DryRun {
  ok: boolean;
  reverted: boolean;
  returnData: string;
  weightRequired: { refTime: bigint; proofSize: bigint };
  storageDeposit: bigint;
  error?: string;
}

/** Dry-run `revive.call` as a native account (no signature, no fees). */
export async function dryRunCall(
  api: ApiPromise,
  origin: string,
  dest: string,
  data: string,
  valuePlanck = 0n
): Promise<DryRun> {
  // Shape verified on portaldot-v3 spec 3002:
  // { weightConsumed, weightRequired, storageDeposit:{charge|refund}, maxStorageDeposit, gasConsumed,
  //   result: Ok{ flags:{bits:u32}, data } | Err(DispatchError) }
  const r: any = await (api.call as any).reviveApi.call(origin, dest, valuePlanck, null, null, data);
  const w = r.weightRequired ?? r.gasRequired;
  const weightRequired = { refTime: BigInt(w.refTime.toString()), proofSize: BigInt(w.proofSize.toString()) };
  const charge = (d: any) => (d?.isCharge ? BigInt(d.asCharge.toString()) : 0n);
  const sd1 = charge(r.storageDeposit);
  const sd2 = charge(r.maxStorageDeposit);
  const storageDeposit = sd1 > sd2 ? sd1 : sd2;
  if (r.result.isErr) {
    const e = r.result.asErr;
    let error = e.toString();
    if (e.isModule) {
      const m = api.registry.findMetaError(e.asModule);
      error = `${m.section}.${m.name}`;
    }
    return { ok: false, reverted: false, returnData: "0x", weightRequired, storageDeposit, error };
  }
  const ok = r.result.asOk;
  const bits = Number(ok.flags.bits?.toString?.() ?? ok.flags.toString());
  const reverted = (bits & 1) === 1; // ReturnFlags::REVERT
  return { ok: !reverted, reverted, returnData: ok.data.toHex(), weightRequired, storageDeposit };
}

/** Decode a Solidity custom error / revert string for humans. */
export function decodeRevert(returnData: string, abi: ethers.InterfaceAbi): string {
  try {
    const parsed = new ethers.Interface(abi).parseError(returnData);
    if (parsed) return parsed.name;
  } catch {}
  try {
    return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + returnData.slice(10))[0];
  } catch {}
  return returnData;
}

const pad = (x: bigint) => (x * 13n) / 10n + 1n; // +30% headroom; unused weight is refunded

/**
 * Build a `revive.call` extrinsic for `origin`, with weight + storage-deposit limits taken
 * from a live dry-run (so the user never pays for blind over-estimates). Throws with the
 * decoded revert reason if the call would fail.
 */
export async function buildReviveCall(
  api: ApiPromise,
  origin: string,
  dest: string,
  data: string,
  valueEvmWei = 0n,
  opts: { abi?: ethers.InterfaceAbi; fallbackWeight?: { refTime: bigint; proofSize: bigint } } = {}
): Promise<SubmittableExtrinsic<"promise">> {
  const value = evmWeiToPlanck(valueEvmWei);
  const dr = await dryRunCall(api, origin, dest, data, value);
  let weight = dr.weightRequired;
  let deposit = dr.storageDeposit;
  if (!dr.ok) {
    if (!opts.fallbackWeight) {
      throw new Error(`call would fail: ${dr.reverted ? decodeRevert(dr.returnData, opts.abi ?? []) : dr.error}`);
    }
    // Dependent call inside a batch (e.g. deposit after approve): use the caller's estimate.
    weight = opts.fallbackWeight;
    deposit = 10n ** 14n; // 1 tPOT cap; only the actual deposit is charged
  }
  return api.tx.revive.call(
    dest,
    value,
    { refTime: pad(weight.refTime), proofSize: pad(weight.proofSize) },
    pad(deposit),
    data
  ) as SubmittableExtrinsic<"promise">;
}

export interface SendResult {
  blockHash: string;
  txHash: string;
  /** events emitted by this extrinsic (for addresses of deployed contracts, etc.) */
  events: any[];
}

/**
 * Sign + submit `calls` atomically as `account` (utility.batchAll), prepending
 * `revive.mapAccount()` when the account isn't mapped yet — one signature, one transaction.
 * `signer` is the Portaldot Extension's injected signer (browser) or a KeyringPair (Node).
 */
export async function sendNative(
  api: ApiPromise,
  account: string,
  calls: SubmittableExtrinsic<"promise">[],
  signer: { signer?: any; pair?: any }
): Promise<SendResult> {
  const txs = [...calls];
  if (!(await isMapped(api, account))) txs.unshift(api.tx.revive.mapAccount() as any);
  const tx = txs.length === 1 ? txs[0] : (api.tx.utility.batchAll(txs) as any);
  return new Promise((resolve, reject) => {
    const cb = ({ status, dispatchError, txHash, events }: any) => {
      if (dispatchError) {
        if (dispatchError.isModule) {
          const d = api.registry.findMetaError(dispatchError.asModule);
          reject(new Error(`${d.section}.${d.name}: ${d.docs.join(" ")}`));
        } else reject(new Error(dispatchError.toString()));
        return;
      }
      if (status.isInBlock) resolve({ blockHash: status.asInBlock.toHex(), txHash: txHash.toHex(), events: events ?? [] });
    };
    const p = signer.pair ? tx.signAndSend(signer.pair, cb) : tx.signAndSend(account, { signer: signer.signer }, cb);
    p.catch(reject);
  });
}
