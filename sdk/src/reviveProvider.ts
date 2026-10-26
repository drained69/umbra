// ReviveProvider — an ethers v6 provider backed by Portaldot's NATIVE APIs, so Umbra runs on
// networks with no EVM JSON-RPC (PortaldotV3 Live has none). Drop-in for every SDK client:
//   new UmbraPoolClient(pool, new ReviveProvider(getApi, chainId))
//
//   call        -> ReviveApi.call dry-run (reverts surface as CALL_EXCEPTION with revert data)
//   getBalance  -> ReviveApi.balance (18-dec EVM units)
//   getLogs     -> revive.ContractEmitted events via state_queryStorage over system.events
//                  (archive node; ~300 blocks per 0.5 s), falling back to per-block reads
//   writes      -> not here: native writes are revive.call extrinsics (see portaldot.ts)

import { ethers } from "ethers";
import type { ApiPromise } from "@polkadot/api";

/** Any funded-or-not account works as the origin of read-only dry-runs. */
const DEFAULT_READ_ORIGIN = "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM"; // all-zero public key

export interface ReviveProviderOptions {
  /** blocks per state_queryStorage request (node limits apply) */
  chunk?: number;
  /** max concurrent per-block reads in fallback mode */
  concurrency?: number;
}

type RawLog = {
  address: string;
  blockHash: string;
  blockNumber: number;
  data: string;
  index: number;
  removed: boolean;
  topics: string[];
  transactionHash: string;
  transactionIndex: number;
};

export class ReviveProvider extends ethers.AbstractProvider {
  readonly #getApi: () => Promise<ApiPromise>;
  readonly #chainId: number;
  readonly #chunk: number;
  readonly #concurrency: number;
  #queryStorageWorks: boolean | null = null;

  constructor(getApi: () => Promise<ApiPromise>, chainId: number, opts: ReviveProviderOptions = {}) {
    super(chainId, { staticNetwork: ethers.Network.from(chainId) } as any);
    this.#getApi = getApi;
    this.#chainId = chainId;
    this.#chunk = opts.chunk ?? 1000;
    this.#concurrency = opts.concurrency ?? 16;
  }

  async _detectNetwork(): Promise<ethers.Network> {
    return ethers.Network.from(this.#chainId);
  }

  async _perform<T = any>(req: ethers.PerformActionRequest): Promise<T> {
    const api = await this.#getApi();
    switch (req.method) {
      case "chainId":
        return BigInt(this.#chainId) as any;
      case "getBlockNumber":
        return (await api.rpc.chain.getHeader()).number.toNumber() as any;
      case "getBalance":
        return BigInt((await (api.call as any).reviveApi.balance(req.address)).toString()) as any;
      case "getCode": {
        const code = await (api.call as any).reviveApi.code(req.address);
        return (code?.toHex?.() ?? "0x") as any;
      }
      case "call":
        return (await this.#call(api, req.transaction)) as any;
      case "getLogs":
        return (await this.#getLogs(api, req.filter)) as any;
      default:
        throw ethers.makeError(`ReviveProvider: ${req.method} is not supported (writes use native revive extrinsics)`, "UNSUPPORTED_OPERATION", {
          operation: req.method,
        });
    }
  }

  async #call(api: ApiPromise, tx: ethers.PerformActionTransaction): Promise<string> {
    let origin = DEFAULT_READ_ORIGIN;
    if (tx.from) origin = (await (api.call as any).reviveApi.accountId(tx.from)).toString();
    const value = BigInt(tx.value ?? 0) / 10n ** 4n; // EVM wei -> planck (nativeToEthRatio)
    const r: any = await (api.call as any).reviveApi.call(origin, tx.to, value, null, null, tx.data ?? "0x");
    if (r.result.isErr) {
      const e = r.result.asErr;
      const m = e.isModule ? api.registry.findMetaError(e.asModule) : null;
      throw ethers.makeError(`execution failed: ${m ? `${m.section}.${m.name}` : e.toString()}`, "CALL_EXCEPTION", {
        action: "call",
        data: null,
        reason: m ? `${m.section}.${m.name}` : null,
        transaction: tx as any,
        invocation: null,
        revert: null,
      });
    }
    const ok = r.result.asOk;
    const data = ok.data.toHex();
    if (Number(ok.flags.bits.toString()) & 1) {
      throw ethers.makeError("execution reverted", "CALL_EXCEPTION", {
        action: "call",
        data,
        reason: null,
        transaction: tx as any,
        invocation: null,
        revert: null,
      });
    }
    return data;
  }

  async #resolveBlock(api: ApiPromise, tag: any, latest: number): Promise<number> {
    if (tag === undefined || tag === null || tag === "latest" || tag === "safe" || tag === "finalized" || tag === "pending") return latest;
    if (tag === "earliest") return 0;
    return Number(BigInt(tag));
  }

  async #getLogs(api: ApiPromise, filter: ethers.PerformActionFilter): Promise<RawLog[]> {
    const latest = (await api.rpc.chain.getHeader()).number.toNumber();
    const f: any = filter;
    if (f.blockHash) throw ethers.makeError("getLogs by blockHash not supported", "UNSUPPORTED_OPERATION", { operation: "getLogs" });
    const from = await this.#resolveBlock(api, f.fromBlock, latest);
    const to = Math.min(await this.#resolveBlock(api, f.toBlock, latest), latest);
    const addrs: Set<string> | null = f.address
      ? new Set((Array.isArray(f.address) ? f.address : [f.address]).map((a: string) => a.toLowerCase()))
      : null;
    const topics: (string | string[] | null)[] = f.topics ?? [];
    const match = (address: string, t: string[]) =>
      (!addrs || addrs.has(address)) &&
      topics.every((want, i) => want === null || want === undefined || (Array.isArray(want) ? want.map((x) => x.toLowerCase()).includes(t[i]) : t[i] === want.toLowerCase()));

    const out: RawLog[] = [];
    if (to < from) return out;

    const collect = async (blockHash: string, blockNumber: number, records: any[]) => {
      let logIndex = 0;
      let block: any = null;
      for (const rec of records) {
        const { event, phase } = rec;
        if (event.section !== "revive" || event.method !== "ContractEmitted") continue;
        const address = event.data[0].toString().toLowerCase();
        const t = (event.data[2] as any).map((x: any) => x.toHex().toLowerCase());
        const idx = logIndex++;
        if (!match(address, t)) continue;
        const txIndex = phase.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : 0;
        if (!block) block = await api.rpc.chain.getBlock(blockHash);
        const ext = block.block.extrinsics[txIndex];
        out.push({
          address: ethers.getAddress(address),
          blockHash,
          blockNumber,
          data: event.data[1].toHex(),
          index: idx,
          removed: false,
          topics: t,
          transactionHash: ext ? ext.hash.toHex() : blockHash,
          transactionIndex: txIndex,
        });
      }
    };

    const hasMatch = (records: any[]) =>
      records.some(
        (r: any) =>
          r.event.section === "revive" &&
          r.event.method === "ContractEmitted" &&
          match(r.event.data[0].toString().toLowerCase(), (r.event.data[2] as any).map((x: any) => x.toHex().toLowerCase()))
      );

    if (this.#queryStorageWorks !== false) {
      try {
        await this.#scanWithQueryStorage(api, from, to, hasMatch, collect);
        this.#queryStorageWorks = true;
        return out.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      } catch {
        this.#queryStorageWorks = false;
        out.length = 0;
      }
    }
    // fallback: per-block event reads
    for (let start = from; start <= to; start += this.#concurrency) {
      const nums = Array.from({ length: Math.min(this.#concurrency, to - start + 1) }, (_, i) => start + i);
      await Promise.all(
        nums.map(async (n) => {
          const hash = (await api.rpc.chain.getBlockHash(n)).toHex();
          await collect(hash, n, (await api.query.system.events.at(hash)) as any);
        })
      );
    }
    return out.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  }

  /**
   * state_queryStorage returns only blocks where system.events CHANGED. A block whose event
   * list is byte-identical to its predecessor is omitted — it emitted exactly the same logs,
   * so those are re-read for every skipped block to stay complete.
   * Chunks are queried in parallel; only blocks with matching logs cost extra round-trips,
   * and those are resolved in parallel too.
   */
  async #scanWithQueryStorage(
    api: ApiPromise,
    from: number,
    to: number,
    hasMatch: (records: any[]) => boolean,
    collect: (hash: string, n: number, records: any[]) => Promise<void>
  ) {
    const key = api.query.system.events.key();
    // exact storage type of system.events, from this runtime's metadata
    const st: any = api.query.system.events.creator.meta.type;
    const eventsType = api.registry.createLookupType(st.isPlain ? st.asPlain : st.asMap.value);

    const ranges: [number, number][] = [];
    for (let start = from; start <= to; start += this.#chunk) ranges.push([start, Math.min(start + this.#chunk - 1, to)]);

    const scanRange = async ([start, end]: [number, number]) => {
      const [fromHash, toHash] = await Promise.all([api.rpc.chain.getBlockHash(start), api.rpc.chain.getBlockHash(end)]);
      // @polkadot/api shapes results as [blockHash, Option<Raw>[]] tuples (one value per key)
      const sets: any[] = await (api.rpc.state as any).queryStorage([key], fromHash, toHash);
      const changes: { hash: string; records: any }[] = [];
      for (const [hash, values] of sets) {
        const v = values?.[0];
        if (v && v.isSome) changes.push({ hash: hash.toHex(), records: api.registry.createType(eventsType as any, v.unwrap().toU8a(true)) });
      }
      const jobs = changes.map((c, i) => ({ c, i })).filter(({ c }) => hasMatch(c.records));
      await Promise.all(
        jobs.map(async ({ c, i }) => {
          const [n, nextN] = await Promise.all([
            api.rpc.chain.getHeader(c.hash).then((h) => h.number.toNumber()),
            i + 1 < changes.length ? api.rpc.chain.getHeader(changes[i + 1].hash).then((h) => h.number.toNumber()) : Promise.resolve(end + 1),
          ]);
          const work = [collect(c.hash, n, c.records)];
          for (let m = n + 1; m < nextN && m <= end; m++) {
            work.push(
              api.rpc.chain.getBlockHash(m).then(async (h) => collect(h.toHex(), m, (await api.query.system.events.at(h)) as any))
            );
          }
          await Promise.all(work);
        })
      );
    };

    for (let i = 0; i < ranges.length; i += this.#concurrency) {
      await Promise.all(ranges.slice(i, i + this.#concurrency).map(scanRange));
    }
  }
}
