// An ethers provider for Portaldot V3 that reads contract state from the EVM JSON-RPC but
// takes event logs from the chain's native `revive.ContractEmitted` events.
//
// Why: Portaldot's EVM RPC only indexes logs from Ethereum-style transactions. Calls made
// from a native (5…) account through `revive.call` — the Portaldot Extension path — emit
// their events natively and never appear in `eth_getLogs` (verified on testnet: a native
// deposit in block 179,779 is missing from eth_getLogs but present as ContractEmitted).
// Pools found by log scanning would otherwise miss native users' deposits and payments.
//
// Logs are cached incrementally per query: blocks safely behind the head never change, so a
// repeated scan (balance refresh, proof building) only fetches blocks it has not seen.

import { ethers } from "ethers";
import type { ApiPromise } from "@polkadot/api";
import { ReviveProvider, type ReviveProviderOptions } from "./reviveProvider";

const SETTLED = 6; // blocks behind the head treated as final

type CachedLogs = { upTo: number; logs: any[] };

function blockNum(tag: unknown, head: number, fallback: number): number {
  if (typeof tag === "number") return tag;
  if (typeof tag === "string" && tag.startsWith("0x")) return Number(tag);
  return tag === undefined ? fallback : head; // "latest" and other tags
}

export class HybridProvider extends ethers.JsonRpcProvider {
  readonly #native: ReviveProvider;
  readonly #cache = new Map<string, CachedLogs>();

  constructor(rpcUrl: string, chainId: number, getApi: () => Promise<ApiPromise>, nativeOpts: ReviveProviderOptions = { chunk: 2000, concurrency: 24 }) {
    super(rpcUrl, chainId, { staticNetwork: true });
    this.#native = new ReviveProvider(getApi, chainId, nativeOpts);
  }

  async _perform<T = any>(req: ethers.PerformActionRequest): Promise<T> {
    if (req.method !== "getLogs") return super._perform(req);
    const f = req.filter as any;
    const head = await this.getBlockNumber();
    const from = blockNum(f.fromBlock, head, head);
    const to = blockNum(f.toBlock, head, head);
    const key = JSON.stringify({ address: f.address, topics: f.topics, from });
    const cached = this.#cache.get(key);
    const known = cached ? cached.logs.filter((l) => Number(l.blockNumber) <= to) : [];
    const start = cached ? cached.upTo + 1 : from;
    if (start > to) return known as T;

    const fresh: any[] = await this.#native._perform({ ...req, filter: { ...f, fromBlock: start, toBlock: to } } as any);
    const settledUpTo = Math.min(to, head - SETTLED);
    if (settledUpTo >= start) {
      this.#cache.set(key, { upTo: settledUpTo, logs: [...(cached?.logs ?? []), ...fresh.filter((l) => Number(l.blockNumber) <= settledUpTo)] });
    }
    return [...known, ...fresh] as T;
  }
}
