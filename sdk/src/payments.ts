// Payment requests between friends: a shareable link (or QR) that asks someone to pay you —
// privately to your shielded address, or publicly to your Portaldot account. Nothing is
// stored on chain until the payer pays.
//  - Private payments carry `rq:<id>:<text>` inside the encrypted note memo, so the requester's
//    scan matches the payment to the request; nobody else can read it.
//  - Public payments batch the transfer with `system.remarkWithEvent("umbra:rq:<id>")`, so a
//    receipt (block hash) proves THIS request was paid and cannot be reused for another one.

import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";
import { ethers } from "ethers";
import { Keypair } from "./keypair";
import { MAX_MEMO_BYTES } from "./utxo";

export interface RequestAsset {
  symbol: string;
  /** null = the native token; otherwise a pallet-assets id */
  assetId: number | null;
  decimals: number;
}

export interface PaymentRequest {
  v: 1;
  id: string; // 16 hex chars
  chainId: number;
  asset: RequestAsset;
  /** decimal string in whole tokens, e.g. "12.5" */
  amount: string;
  /** where to pay: a shielded address (private), a Portaldot account (public), or both */
  to: { shielded?: string; account?: string };
  /** requester's display name */
  name?: string;
  memo?: string;
  created: number; // unix ms
}

export interface PaymentReceipt {
  v: 1;
  id: string;
  chainId: number;
  blockHash: string;
}

const DECIMAL = /^\d+(\.\d+)?$/;
const MAX_TEXT = 60;

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Smallest units for a decimal amount; rejects more precision than the asset has. */
export function toUnits(amount: string, decimals: number): bigint {
  if (!DECIMAL.test(amount.trim())) throw new Error("enter an amount like 12.5");
  return ethers.parseUnits(amount.trim(), decimals);
}

export function newRequestId(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

export function createRequest(r: Omit<PaymentRequest, "v" | "id" | "created"> & { id?: string }): PaymentRequest {
  const req: PaymentRequest = { v: 1, id: r.id ?? newRequestId(), created: Date.now(), ...r } as PaymentRequest;
  return validateRequest(req);
}

export function validateRequest(r: PaymentRequest): PaymentRequest {
  if (r.v !== 1 || !/^[0-9a-f]{16}$/.test(r.id)) throw new Error("not an Umbra payment request");
  if (!Number.isInteger(r.chainId)) throw new Error("payment request has no network");
  if (!r.asset || typeof r.asset.symbol !== "string" || !Number.isInteger(r.asset.decimals)) throw new Error("payment request has no asset");
  if (toUnits(r.amount, r.asset.decimals) <= 0n) throw new Error("payment request amount must be positive");
  if (!r.to?.shielded && !r.to?.account) throw new Error("payment request has nowhere to pay");
  if (r.to.shielded) Keypair.publicFromAddress(r.to.shielded); // throws on a malformed address
  if (r.to.shielded && r.asset.assetId !== null) throw new Error("private payments support the native token only");
  if (r.memo && r.memo.length > MAX_TEXT) r.memo = r.memo.slice(0, MAX_TEXT);
  if (r.name && r.name.length > 40) r.name = r.name.slice(0, 40);
  return r;
}

export function encodeRequest(r: PaymentRequest): string {
  return b64url(JSON.stringify(r));
}

export function decodeRequest(encoded: string): PaymentRequest {
  let parsed: PaymentRequest;
  try {
    parsed = JSON.parse(unb64url(encoded.trim()));
  } catch {
    throw new Error("this payment link is damaged");
  }
  return validateRequest(parsed);
}

/** `https://app/?pay=…` */
export function requestLink(baseUrl: string, r: PaymentRequest): string {
  const u = new URL(baseUrl);
  u.search = "";
  u.hash = "";
  u.searchParams.set("pay", encodeRequest(r));
  return u.toString();
}

// ---------------------------------------------------------------- memos

/** Encrypted-note memo that ties a private payment to a request: `rq:<id>:<text>`. */
export function requestMemo(id: string, text = ""): string {
  let memo = `rq:${id}:${text}`;
  while (new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) memo = memo.slice(0, -1);
  return memo;
}

export function parseMemo(memo: string | undefined): { requestId?: string; text: string } {
  if (!memo) return { text: "" };
  const m = /^rq:([0-9a-f]{16}):([\s\S]*)$/.exec(memo);
  return m ? { requestId: m[1], text: m[2] } : { text: memo };
}

// ---------------------------------------------------------------- splitting a bill

/** Split `total` into `n` shares that add up exactly (the first shares absorb the remainder). */
export function splitAmount(total: string, decimals: number, n: number): string[] {
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error("split between 1 and 50 people");
  const units = toUnits(total, decimals);
  const base = units / BigInt(n);
  const rest = units % BigInt(n);
  return Array.from({ length: n }, (_, i) => ethers.formatUnits(base + (BigInt(i) < rest ? 1n : 0n), decimals));
}

// ---------------------------------------------------------------- public payments

export function requestRemark(id: string): string {
  return `umbra:rq:${id}`;
}

/** Native account for a 5… address or a 0x address (resolved through pallet-revive's mapping). */
export async function resolveAccount(api: ApiPromise, input: string): Promise<string> {
  const s = input.trim();
  if (ethers.isAddress(s)) return (await (api.call as any).reviveApi.accountId(ethers.getAddress(s))).toString();
  try {
    return api.createType("AccountId32", s).toString();
  } catch {
    throw new Error("enter a Portaldot (5…) or 0x address");
  }
}

/**
 * A public transfer (native token or a pallet-assets token), optionally tagged with a
 * request id. Keep-alive variants never reap the sender's account.
 */
export function publicTransferCalls(
  api: ApiPromise,
  p: { assetId: number | null; to: string; amount: bigint; requestId?: string }
): SubmittableExtrinsic<"promise">[] {
  const transfer =
    p.assetId === null ? api.tx.balances.transferKeepAlive(p.to, p.amount) : api.tx.assets.transferKeepAlive(p.assetId, p.to, p.amount);
  const calls = [transfer as SubmittableExtrinsic<"promise">];
  if (p.requestId) calls.push(api.tx.system.remarkWithEvent(requestRemark(p.requestId)) as SubmittableExtrinsic<"promise">);
  return calls;
}

export function encodeReceipt(r: PaymentReceipt): string {
  return b64url(JSON.stringify(r));
}

export function decodeReceipt(encoded: string): PaymentReceipt {
  const r = JSON.parse(unb64url(encoded.trim()));
  if (r?.v !== 1 || !/^[0-9a-f]{16}$/.test(r.id) || !/^0x[0-9a-f]{64}$/i.test(r.blockHash)) throw new Error("not an Umbra payment receipt");
  return r;
}

/**
 * Check a public-payment receipt against its request on chain: one extrinsic in that block
 * must both transfer at least the requested amount to the requester's account and emit the
 * request's remark. Returns the payer's account, or null if the receipt does not prove payment.
 */
export async function verifyReceipt(api: ApiPromise, req: PaymentRequest, receipt: PaymentReceipt): Promise<{ payer: string; amount: bigint } | null> {
  if (receipt.id !== req.id || receipt.chainId !== req.chainId || !req.to.account) return null;
  const want = toUnits(req.amount, req.asset.decimals);
  const to = api.createType("AccountId32", req.to.account).toHex();
  const remarkHash = "0x" + bytesToHex(blake2b(new TextEncoder().encode(requestRemark(req.id)), { dkLen: 32 }));
  const events: any[] = (await api.query.system.events.at(receipt.blockHash)) as any;

  const byExtrinsic = new Map<number, any[]>();
  for (const rec of events) {
    if (!rec.phase.isApplyExtrinsic) continue;
    const i = rec.phase.asApplyExtrinsic.toNumber();
    byExtrinsic.set(i, [...(byExtrinsic.get(i) ?? []), rec.event]);
  }
  for (const evs of byExtrinsic.values()) {
    if (!evs.some((e) => e.section === "system" && e.method === "ExtrinsicSuccess")) continue;
    if (!evs.some((e) => e.section === "system" && e.method === "Remarked" && e.data[1].toHex() === remarkHash)) continue;
    for (const e of evs) {
      const native = req.asset.assetId === null && e.section === "balances" && e.method === "Transfer";
      const asset = req.asset.assetId !== null && e.section === "assets" && e.method === "Transferred" && Number(e.data[0].toString()) === req.asset.assetId;
      if (!native && !asset) continue;
      const [from, dest, amount] = native ? [e.data[0], e.data[1], e.data[2]] : [e.data[1], e.data[2], e.data[3]];
      if (dest.toHex() === to && BigInt(amount.toString()) >= want) return { payer: from.toString(), amount: BigInt(amount.toString()) };
    }
  }
  return null;
}
