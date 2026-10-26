import { ethers } from "ethers";
import { Keypair, type PaymentRequest, type RequestAsset } from "@umbra/sdk";
import { DEPLOYMENT, NATIVE } from "./chain";
import { readStored, storeKey, useStored, writeStored } from "./store";

// Contacts, the activity log and "my requests" — kept in this browser only.

export const TPOT: RequestAsset = { symbol: NATIVE, assetId: null, decimals: 18 };
export const PUSD: RequestAsset | null = DEPLOYMENT.contracts.tokens?.pUSD
  ? { symbol: "pUSD", assetId: Number(DEPLOYMENT.contracts.tokens.pUSD.assetId), decimals: Number(DEPLOYMENT.contracts.tokens.pUSD.decimals) }
  : null;
export const ASSETS: RequestAsset[] = PUSD ? [TPOT, PUSD] : [TPOT];
/** Native-token amounts move between the EVM (18 decimals) and native pallets (14 decimals). */
export const NATIVE_PLANCK_DECIMALS = 14;

export const fmt = (units: bigint, decimals: number, max = 6) =>
  Number(ethers.formatUnits(units, decimals)).toLocaleString(undefined, { maximumFractionDigits: max });

// ---------------------------------------------------------------- contacts

export interface Contact {
  id: string;
  name: string;
  /** Portaldot 5… or 0x address, for public payments */
  account?: string;
  /** umbra-addr-…, for private payments */
  shielded?: string;
}

export function validShielded(addr: string): boolean {
  try {
    Keypair.publicFromAddress(addr.trim());
    return /^umbra-addr-/.test(addr.trim());
  } catch {
    return false;
  }
}

export function useContacts() {
  const [contacts, setContacts] = useStored<Contact[]>(storeKey("contacts"), []);
  return {
    contacts,
    save: (c: Contact) => setContacts((list) => [...list.filter((x) => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name))),
    remove: (id: string) => setContacts((list) => list.filter((x) => x.id !== id)),
  };
}

// ---------------------------------------------------------------- activity

export interface ActivityItem {
  id: string;
  at: number;
  kind: "send" | "request" | "pay" | "swap" | "shield" | "withdraw" | "receive";
  title: string;
  detail?: string;
  href?: string;
  private?: boolean;
}

export function logActivity(item: Omit<ActivityItem, "id" | "at">): void {
  const key = storeKey("activity");
  const next = [{ ...item, id: crypto.randomUUID(), at: Date.now() }, ...readStored<ActivityItem[]>(key, [])].slice(0, 100);
  writeStored(key, next);
}

export function useActivity(): ActivityItem[] {
  return useStored<ActivityItem[]>(storeKey("activity"), [])[0];
}

// ---------------------------------------------------------------- my requests

export interface StoredRequest {
  request: PaymentRequest;
  /** who it was sent to, if known */
  who?: string;
  /** split-bill group */
  group?: string;
  status: "open" | "paid";
  paidAt?: number;
  paidVia?: "private" | "public" | "manual";
  payer?: string;
}

export function useMyRequests() {
  const [requests, setRequests] = useStored<StoredRequest[]>(storeKey("requests"), []);
  return {
    requests,
    add: (items: StoredRequest[]) => setRequests((list) => [...items, ...list]),
    markPaid: (id: string, via: StoredRequest["paidVia"], payer?: string) => markRequestPaid(id, via, payer),
    remove: (id: string) => setRequests((list) => list.filter((r) => r.request.id !== id)),
  };
}

export function markRequestPaid(id: string, via: StoredRequest["paidVia"], payer?: string): boolean {
  const key = storeKey("requests");
  const list = readStored<StoredRequest[]>(key, []);
  const hit = list.find((r) => r.request.id === id && r.status === "open");
  if (!hit) return false;
  writeStored(key, list.map((r) => (r === hit ? { ...r, status: "paid" as const, paidAt: Date.now(), paidVia: via, payer } : r)));
  return true;
}

export function findMyRequest(id: string): StoredRequest | undefined {
  return readStored<StoredRequest[]>(storeKey("requests"), []).find((r) => r.request.id === id);
}

/** Remembered display name for requests ("Alice"). */
export function useMyName() {
  return useStored<string>(storeKey("name"), "");
}
