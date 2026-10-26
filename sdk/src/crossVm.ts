// Cross-VM verification from a native Portaldot account (docs/CROSS_VM.md, Path B).
//
// The Groth16 pairing check runs in Portaldot's WASM VM — the ink! `umbra_coprocessor` on
// pallet-contracts — and its result is mirrored onto the EVM `UmbraCoprocessorBridge` the
// pool trusts. Both calls go out in ONE `utility.batchAll` signed in the Portaldot
// Extension: `verify_or_revert` reverts on an invalid proof, so the EVM attestation is rolled
// back with it. The bridge still trusts its attestor key to only attest this way.

import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { ethers } from "ethers";
import { buildReviveCall, decodeRevert, dryRunCall, sendNative, type SendResult } from "./portaldot";

/** sdk/artifacts/coprocessor.json (scripts/export-coprocessor.js). */
export interface CoprocessorArtifact {
  codeHash: string;
  selectors: Record<string, string>;
  withdrawVkWords: string[];
  wasm: string;
}

/** A Groth16 proof as 32-byte words: G2 `b` in EVM precompile order, signals in circuit order. */
export interface Groth16Words {
  a: [string, string];
  b: [string, string, string, string];
  c: [string, string];
  inputs: string[];
}

export const BRIDGE_ABI = [
  "function attest(bytes32 proofHash)",
  "function attested(bytes32) view returns (bool)",
  "function attestor() view returns (address)",
  "function coprocessor() view returns (address)",
  "function proofHashOf(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] publicSignals) view returns (bytes32)",
  "error NotAttestor()",
];
const BRIDGE = new ethers.Interface(BRIDGE_ABI);

const word = (x: bigint | string) => ethers.zeroPadValue(ethers.toBeHex(BigInt(x)), 32);
const pad = (x: bigint) => (x * 13n) / 10n + 1n; // unused weight is refunded; deposit is charged as used

/**
 * Public signals exactly as `UmbraPoolBase.withdraw` builds them for its verifier — the
 * attestation hash must match those bytes, so derive them from the call's own arguments.
 */
export function withdrawSignals(root: bigint, nullifierHash: bigint, recipient: string, relayer: string, fee: bigint, refund = 0n): bigint[] {
  return [root, nullifierHash, BigInt(ethers.getAddress(recipient)), BigInt(ethers.getAddress(relayer)), fee, refund];
}

export function groth16Words(proof: { a: [string, string]; b: [[string, string], [string, string]]; c: [string, string] }, signals: bigint[]): Groth16Words {
  return {
    a: [word(proof.a[0]), word(proof.a[1])],
    b: [word(proof.b[0][0]), word(proof.b[0][1]), word(proof.b[1][0]), word(proof.b[1][1])],
    c: [word(proof.c[0]), word(proof.c[1])],
    inputs: signals.map(word),
  };
}

// ---------------------------------------------------------------- SCALE encoding (ink! 5)

/** Vec<[u8; 32]> = compact length ++ words; fixed arrays are the raw words. */
function vecWords(api: ApiPromise, words: string[]): string {
  return ethers.concat([api.createType("Compact<u32>", words.length).toU8a(), ...words]);
}

function selector(art: CoprocessorArtifact, label: string): string {
  const s = art.selectors[label];
  if (!s) throw new Error(`coprocessor artifact has no "${label}" selector`);
  return s;
}

export function encodeCoprocessorNew(api: ApiPromise, art: CoprocessorArtifact): string {
  return ethers.concat([selector(art, "new"), vecWords(api, art.withdrawVkWords)]);
}

export function encodeProofMessage(api: ApiPromise, art: CoprocessorArtifact, label: "verify_or_revert" | "check" | "is_verified", w: Groth16Words): string {
  return ethers.concat([selector(art, label), ...w.a, ...w.b, ...w.c, vecWords(api, w.inputs)]);
}

// ---------------------------------------------------------------- WASM dry-runs (pallet-contracts)

export interface WasmDryRun {
  ok: boolean;
  reverted: boolean;
  /** SS58 address of the would-be contract (instantiate only) */
  address?: string;
  weight: { refTime: bigint; proofSize: bigint };
  deposit: bigint; // planck
  /** SCALE-encoded return value */
  data: string;
  error?: string;
}

function readDryRun(api: ApiPromise, r: any): WasmDryRun {
  const w = r.gasRequired;
  const weight = { refTime: BigInt(w.refTime.toString()), proofSize: BigInt(w.proofSize.toString()) };
  const deposit = r.storageDeposit?.isCharge ? BigInt(r.storageDeposit.asCharge.toString()) : 0n;
  if (r.result.isErr) {
    const e = r.result.asErr;
    const m = e.isModule ? api.registry.findMetaError(e.asModule) : null;
    return { ok: false, reverted: false, weight, deposit, data: "0x", error: m ? `${m.section}.${m.name}` : e.toString() };
  }
  const ok = r.result.asOk;
  const exec = ok.result ?? ok; // instantiate wraps the exec result: { result, accountId }
  const reverted = (Number(exec.flags.bits?.toString?.() ?? exec.flags.toString()) & 1) === 1; // ReturnFlags::REVERT
  return { ok: !reverted, reverted, address: ok.accountId?.toString(), weight, deposit, data: exec.data.toHex() };
}

export async function dryRunCoprocessorInstantiate(api: ApiPromise, origin: string, art: CoprocessorArtifact): Promise<WasmDryRun> {
  const r = await (api.call as any).contractsApi.instantiate(origin, 0, null, null, { Upload: art.wasm }, encodeCoprocessorNew(api, art), "0x");
  return readDryRun(api, r);
}

export async function dryRunWasmCall(api: ApiPromise, origin: string, dest: string, data: string): Promise<WasmDryRun> {
  const r = await (api.call as any).contractsApi.call(origin, dest, 0, null, null, data);
  return readDryRun(api, r);
}

/**
 * Read-only: does the WASM coprocessor accept this proof? Runs the full pairing check in
 * the WASM VM. `check` returns `Result<Result<bool, Error>, LangError>`: Ok(Ok(true)) = 00 00 01.
 */
export async function wasmCheck(api: ApiPromise, origin: string, coprocessor: string, art: CoprocessorArtifact, w: Groth16Words): Promise<boolean> {
  const dr = await dryRunWasmCall(api, origin, coprocessor, encodeProofMessage(api, art, "check", w));
  if (!dr.ok) throw new Error(`WASM coprocessor call failed: ${dr.error ?? "reverted"}`);
  return dr.data.toLowerCase() === "0x000001";
}

// ---------------------------------------------------------------- deployment

/** Instantiate the coprocessor (withdraw circuit key) with `contracts.instantiateWithCode`. */
export async function deployCoprocessor(
  api: ApiPromise,
  account: string,
  auth: { signer?: any; pair?: any },
  art: CoprocessorArtifact
): Promise<SendResult & { address: string; deposit: bigint }> {
  const dr = await dryRunCoprocessorInstantiate(api, account, art);
  if (!dr.ok) throw new Error(`coprocessor deployment would fail: ${dr.error ?? "constructor reverted"}`);
  const tx = api.tx.contracts.instantiateWithCode(
    0,
    { refTime: pad(dr.weight.refTime), proofSize: pad(dr.weight.proofSize) },
    pad(dr.deposit),
    art.wasm,
    encodeCoprocessorNew(api, art),
    "0x"
  ) as SubmittableExtrinsic<"promise">;
  const res = await sendNative(api, account, [tx], auth);
  const me = api.createType("AccountId32", account).toHex();
  const ev = res.events.find(
    ({ event }: any) => event.section === "contracts" && event.method === "Instantiated" && event.data[0].toHex() === me
  );
  if (!ev) throw new Error("deployed, but no contracts.Instantiated event for this account was found");
  return { ...res, address: ev.event.data[1].toString(), deposit: dr.deposit };
}

/** Code hash of a pallet-contracts contract, or null if none lives at `address`. */
export async function wasmCodeHash(api: ApiPromise, address: string): Promise<string | null> {
  const info: any = await (api.query as any).contracts.contractInfoOf(address);
  return info.isSome ? info.unwrap().codeHash.toHex() : null;
}

// ---------------------------------------------------------------- bridge reads (via revive dry-runs)

async function bridgeRead(api: ApiPromise, origin: string, bridge: string, fn: string, args: unknown[]): Promise<ethers.Result> {
  const dr = await dryRunCall(api, origin, bridge, BRIDGE.encodeFunctionData(fn, args));
  if (!dr.ok) throw new Error(`bridge.${fn} failed: ${dr.reverted ? decodeRevert(dr.returnData, BRIDGE_ABI) : dr.error}`);
  return BRIDGE.decodeFunctionResult(fn, dr.returnData);
}

const evmProofArgs = (w: Groth16Words) => [w.a, [[w.b[0], w.b[1]], [w.b[2], w.b[3]]], w.c, w.inputs];

/** The bridge's own domain-separated hash (chain id + bridge address + proof + signals). */
export async function bridgeProofHash(api: ApiPromise, origin: string, bridge: string, w: Groth16Words): Promise<string> {
  return (await bridgeRead(api, origin, bridge, "proofHashOf", evmProofArgs(w)))[0];
}

export async function bridgeAttestor(api: ApiPromise, origin: string, bridge: string): Promise<string> {
  return ethers.getAddress((await bridgeRead(api, origin, bridge, "attestor", []))[0]);
}

// ---------------------------------------------------------------- the cross-VM step

export interface CrossVmAttestResult {
  proofHash: string;
  /** null if the proof was already attested (nothing was signed) */
  tx: SendResult | null;
}

/**
 * Verify `w` in the WASM coprocessor and attest it on the EVM bridge in one atomic,
 * extension-signed batch. `account` must be the bridge's attestor. Afterwards the pool's
 * `withdraw` with the same proof succeeds.
 */
export async function verifyInWasmAndAttest(
  api: ApiPromise,
  account: string,
  auth: { signer?: any; pair?: any },
  cfg: { coprocessor: string; bridge: string; art: CoprocessorArtifact },
  w: Groth16Words
): Promise<CrossVmAttestResult> {
  const proofHash = await bridgeProofHash(api, account, cfg.bridge, w);
  if ((await bridgeRead(api, account, cfg.bridge, "attested", [proofHash]))[0]) return { proofHash, tx: null };

  const data = encodeProofMessage(api, cfg.art, "verify_or_revert", w);
  const dr = await dryRunWasmCall(api, account, cfg.coprocessor, data);
  if (!dr.ok) throw new Error(dr.reverted ? "the WASM coprocessor rejected this proof" : `WASM coprocessor call failed: ${dr.error}`);
  const verify = api.tx.contracts.call(
    cfg.coprocessor,
    0,
    { refTime: pad(dr.weight.refTime), proofSize: pad(dr.weight.proofSize) },
    pad(dr.deposit),
    data
  ) as SubmittableExtrinsic<"promise">;
  // Dry-run alone: reverts with NotAttestor unless `account` is the bridge's attestor.
  const attest = await buildReviveCall(api, account, cfg.bridge, BRIDGE.encodeFunctionData("attest", [proofHash]), 0n, { abi: BRIDGE_ABI });
  return { proofHash, tx: await sendNative(api, account, [verify, attest], auth) };
}
