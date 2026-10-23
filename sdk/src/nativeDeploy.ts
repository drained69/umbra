// Deploy Umbra from a NATIVE Portaldot account (Portaldot Extension signs; no EVM key, no
// EVM RPC). Each contract is a `revive.instantiateWithCode` extrinsic whose weight and
// storage-deposit limits come from a live dry-run; the new address is read from the
// `revive.Instantiated { deployer, contract }` event emitted for the deployer's H160.

import type { ApiPromise } from "@polkadot/api";
import { ethers } from "ethers";
import { assetErc20Address, evmAddressOf, sendNative, type SendResult } from "./portaldot";

export type Bytecodes = Record<
  "Poseidon2" | "WithdrawVerifier" | "TransactionVerifier" | "UmbraPool" | "UmbraTokenPool" | "UmbraShieldedPool" | "DeployHarness",
  string
>;

export interface DeployConfig {
  nativeDenoms: string[]; // whole tPOT, e.g. ["100"]
  token?: { assetId: number; symbol: string; decimals: number; denoms: string[] }; // e.g. pUSD
  shielded: boolean; // join-split pool
  levels?: number; // tree depth (must match the circuits: 20)
}

export interface DeployStep {
  id: string; // stable key, e.g. "pool:tPOT:100"
  label: string;
  /** creation code incl. constructor args; may depend on earlier steps' addresses */
  initcode: (addr: Record<string, string>) => string;
}

const abi = ethers.AbiCoder.defaultAbiCoder();
const LEVELS = 20;

/** Ordered steps for a configuration (dependencies first). Pools are deployed directly (no factory). */
export function planDeployment(code: Bytecodes, cfg: DeployConfig): DeployStep[] {
  const levels = cfg.levels ?? LEVELS;
  const steps: DeployStep[] = [
    { id: "poseidon", label: "Poseidon(2) hasher", initcode: () => code.Poseidon2 },
    { id: "withdrawVerifier", label: "Withdraw verifier (Groth16)", initcode: () => code.WithdrawVerifier },
  ];
  for (const d of cfg.nativeDenoms) {
    steps.push({
      id: `pool:tPOT:${d}`,
      label: `${d} tPOT pool`,
      initcode: (a) =>
        ethers.concat([code.UmbraPool, abi.encode(["address", "address", "uint256", "uint32"], [a.withdrawVerifier, a.poseidon, ethers.parseUnits(d, 18), levels])]),
    });
  }
  if (cfg.token) {
    const t = cfg.token;
    for (const d of t.denoms) {
      steps.push({
        id: `pool:${t.symbol}:${d}`,
        label: `${d} ${t.symbol} pool (asset #${t.assetId})`,
        initcode: (a) =>
          ethers.concat([
            code.UmbraTokenPool,
            abi.encode(["address", "address", "address", "uint256", "uint32"], [a.withdrawVerifier, a.poseidon, assetErc20Address(t.assetId), ethers.parseUnits(d, t.decimals), levels]),
          ]),
      });
    }
  }
  if (cfg.shielded) {
    steps.push({ id: "transactionVerifier", label: "Join-split verifier (Groth16)", initcode: () => code.TransactionVerifier });
    steps.push({
      id: "shieldedPool",
      label: "Join-split shielded pool",
      initcode: (a) => ethers.concat([code.UmbraShieldedPool, abi.encode(["address", "address", "uint32"], [a.transactionVerifier, a.poseidon, levels])]),
    });
  }
  return steps;
}

export interface InstantiateDryRun {
  ok: boolean;
  address?: string;
  weight: { refTime: bigint; proofSize: bigint };
  deposit: bigint; // planck
  error?: string;
}

export async function dryRunInstantiate(api: ApiPromise, origin: string, initcode: string): Promise<InstantiateDryRun> {
  const r: any = await (api.call as any).reviveApi.instantiate(origin, 0, null, null, { Upload: initcode }, "0x", null);
  const w = r.weightRequired;
  const weight = { refTime: BigInt(w.refTime.toString()), proofSize: BigInt(w.proofSize.toString()) };
  const charge = (d: any) => (d?.isCharge ? BigInt(d.asCharge.toString()) : 0n);
  const deposit = [charge(r.storageDeposit), charge(r.maxStorageDeposit)].reduce((a, b) => (a > b ? a : b));
  if (r.result.isErr) {
    const e = r.result.asErr;
    const m = e.isModule ? api.registry.findMetaError(e.asModule) : null;
    return { ok: false, weight, deposit, error: m ? `${m.section}.${m.name}` : e.toString() };
  }
  const ok = r.result.asOk;
  if (Number(ok.result.flags.bits.toString()) & 1) return { ok: false, weight, deposit, error: "constructor reverted" };
  return { ok: true, address: ethers.getAddress(ok.addr.toString()), weight, deposit };
}

const pad = (x: bigint) => (x * 13n) / 10n + 1n; // unused weight is refunded; deposit is charged as used

/** Deploy one contract from a native account; returns its EVM address and block. */
export async function deployNative(
  api: ApiPromise,
  account: string,
  auth: { signer?: any; pair?: any },
  initcode: string
): Promise<SendResult & { address: string; deposit: bigint }> {
  const dr = await dryRunInstantiate(api, account, initcode);
  if (!dr.ok) throw new Error(`deployment would fail: ${dr.error}`);
  const tx = api.tx.revive.instantiateWithCode(0, { refTime: pad(dr.weight.refTime), proofSize: pad(dr.weight.proofSize) }, pad(dr.deposit), initcode, "0x", null) as any;
  const res = await sendNative(api, account, [tx], auth);
  const me = (await evmAddressOf(api, account)).toLowerCase();
  const ev = res.events.find(
    ({ event }: any) => event.section === "revive" && event.method === "Instantiated" && event.data[0].toString().toLowerCase() === me
  );
  if (!ev) throw new Error("deployed, but no Instantiated event for this account was found");
  return { ...res, address: ethers.getAddress(ev.event.data[1].toString()), deposit: dr.deposit };
}

/** True if a contract already lives at `address` (used to resume an interrupted deployment). */
export async function contractExists(api: ApiPromise, address: string): Promise<boolean> {
  const info: any = await (api.query as any).revive.accountInfoOf(address);
  return info.isSome;
}

export interface DeployEstimate {
  deposit: bigint; // planck
  fee: bigint; // planck (approx.)
  origin: string;
  sufficientFunds: boolean;
}

/**
 * Price the WHOLE plan in one read-only dry-run (DeployHarness deploys everything inside its
 * constructor). Tries `account` first; if it can't afford it, re-prices from `richOrigin` so
 * the user still sees the exact amount needed.
 */
export async function estimateDeployment(
  api: ApiPromise,
  account: string,
  code: Bytecodes,
  cfg: DeployConfig,
  richOrigin?: string
): Promise<DeployEstimate> {
  const levelsOk = (cfg.levels ?? LEVELS) === LEVELS;
  if (!levelsOk) throw new Error("estimate supports the 20-level circuits only");
  const token = cfg.token ? assetErc20Address(cfg.token.assetId) : ethers.ZeroAddress;
  const init = ethers.concat([
    code.DeployHarness,
    abi.encode(
      ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "uint256[]", "address", "uint256[]"],
      [
        code.Poseidon2,
        code.WithdrawVerifier,
        code.TransactionVerifier,
        code.UmbraPool,
        code.UmbraTokenPool,
        cfg.shielded ? code.UmbraShieldedPool : "0x",
        cfg.nativeDenoms.map((d) => ethers.parseUnits(d, 18)),
        token,
        cfg.token ? cfg.token.denoms.map((d) => ethers.parseUnits(d, cfg.token!.decimals)) : [],
      ]
    ),
  ]);
  let origin = account;
  let dr = await dryRunInstantiate(api, origin, init);
  let sufficientFunds = dr.ok;
  if (!dr.ok && richOrigin) {
    origin = richOrigin;
    dr = await dryRunInstantiate(api, origin, init);
    sufficientFunds = false;
  }
  if (!dr.ok) throw new Error(`could not price deployment: ${dr.error}`);
  const tx = api.tx.revive.instantiateWithCode(0, { refTime: dr.weight.refTime, proofSize: dr.weight.proofSize }, dr.deposit, init, "0x", null);
  const fee = (await tx.paymentInfo(origin)).partialFee.toBigInt();
  return { deposit: dr.deposit, fee, origin, sufficientFunds };
}
