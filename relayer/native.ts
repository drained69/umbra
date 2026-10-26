/*
 * Native-account half of the relayer: it signs as a Portaldot (sr25519) account so it can
 * submit to the multi-asset private pool and act as the counterparty for private swaps,
 * hedging each one on Portaldot's built-in exchange (pallet-asset-conversion) inside the
 * same atomic `utility.batchAll`. If the exchange can't fill at the user's price, the whole
 * batch reverts and the user's notes stay unspent.
 *
 * Enabled when RELAYER_SEED is set. Runs under tsx (it imports the SDK's TypeScript).
 */
import { ethers } from "ethers";
import {
  MULTI_ASSET_POOL_ABI,
  ERC20_ABI,
  buildReviveCall,
  evmAddressOf,
  quoteExactIn,
  quoteExactOut,
  sendNative,
  swapCall,
  type DexAsset,
} from "../sdk/src/index";
import { ApiPromise, Keyring, WsProvider, cryptoWaitReady } from "../sdk/src/node";

const WEI_PER_PLANCK = 10n ** 4n; // pallet-revive: EVM wei = planck * 10^4
const POOL = new ethers.Interface(MULTI_ASSET_POOL_ABI);
const ERC20 = new ethers.Interface(ERC20_ABI);

export interface MultiAssetConfig {
  pool: string;
  /** asset id -> { symbol, decimals, address (null = native), dex asset } */
  assets: { id: number; symbol: string; address: string | null; assetId?: number | null; decimals: number }[];
}

export interface NativeRelayer {
  account: string;
  evm: string; // the account's mapped H160: bound into proofs as relayer and swap counterparty
  api: ApiPromise;
  /** fee for one private-pool transaction, per asset id, in pool units */
  fees(): Promise<Record<number, bigint>>;
  /** quote a private swap of `amountIn` (pool units of `sell`) */
  quoteSwap(sell: number, buy: number, amountIn: bigint): Promise<{ amountOut: bigint; fee: bigint; priceImpactBps: number }>;
  /** submit a plain multi-asset transact (payment or withdrawal) */
  transact(args: any, extData: any): Promise<{ blockHash: string; txHash: string }>;
  /** execute a private swap: DEX hedge + pool transact, atomically */
  swap(args: any, extData: any): Promise<{ blockHash: string; txHash: string }>;
}

/** Spread the relayer keeps between the exchange price and the amount it promises. */
const SPREAD_BPS = Number(process.env.RELAYER_SWAP_SPREAD_BPS || 50);
// Measured cost of a transact (sdk/test/relay_cost_live.ts): weight 52.6e9 / 591k; deposit 7.68 tPOT.
const TRANSACT_WEIGHT = { refTime: 150_000_000_000n, proofSize: 1_500_000n };
const TRANSACT_DEPOSIT_CAP = 12n * 10n ** 14n;

export async function startNativeRelayer(opts: { ws: string; seed: string; ma: MultiAssetConfig; nativeFee: bigint }): Promise<NativeRelayer> {
  await cryptoWaitReady();
  const pair = new Keyring({ type: "sr25519" }).addFromUri(opts.seed);
  const api = await ApiPromise.create({ provider: new WsProvider(opts.ws), noInitWarn: true });
  const account = pair.address;
  const evm = await evmAddressOf(api, account);
  const pool = ethers.getAddress(opts.ma.pool);
  const assets = new Map(opts.ma.assets.map((a) => [a.id, a]));
  const dexAsset = (id: number): DexAsset => {
    const a = assets.get(id);
    if (!a) throw new Error("unknown asset");
    return a.address === null ? "native" : Number(a.assetId);
  };
  // pool units -> exchange units (native: wei -> planck; tokens are the same)
  const toDex = (id: number, x: bigint) => (assets.get(id)!.address === null ? x / WEI_PER_PLANCK : x);
  const fromDex = (id: number, x: bigint) => (assets.get(id)!.address === null ? x * WEI_PER_PLANCK : x);

  // one extrinsic at a time from this account (nonces)
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = chain.then(fn);
    chain = r.catch(() => {});
    return r;
  };

  async function fees(): Promise<Record<number, bigint>> {
    const out: Record<number, bigint> = {};
    for (const a of opts.ma.assets) {
      if (a.address === null) out[a.id] = opts.nativeFee;
      else {
        // the same cost in this token, at the exchange price (+ spread), rounded up to a cent-ish
        const q = await quoteExactIn(api, "native", dexAsset(a.id), toDex(0, opts.nativeFee), 0);
        out[a.id] = (q.amountOut * BigInt(10000 + SPREAD_BPS)) / 10000n + 1n;
      }
    }
    return out;
  }

  async function quoteSwap(sell: number, buy: number, amountIn: bigint) {
    if (sell === buy || !assets.has(sell) || !assets.has(buy)) throw new Error("unsupported pair");
    const q = await quoteExactIn(api, dexAsset(sell), dexAsset(buy), toDex(sell, amountIn), SPREAD_BPS);
    let amountOut = fromDex(buy, q.limit);
    return { amountOut, fee: (await fees())[sell], priceImpactBps: q.priceImpactBps };
  }

  const transactCall = (args: any, extData: any, value: bigint, dependent: boolean) =>
    buildReviveCall(api, account, pool, POOL.encodeFunctionData("transact", [args, extData]), value, {
      abi: MULTI_ASSET_POOL_ABI,
      fallbackWeight: dependent ? TRANSACT_WEIGHT : undefined,
      fallbackDeposit: TRANSACT_DEPOSIT_CAP,
    });

  async function transact(args: any, extData: any) {
    return exclusive(async () => {
      const call = await transactCall(args, extData, 0n, false);
      const r = await sendNative(api, account, [call], { pair });
      return { blockHash: r.blockHash, txHash: r.txHash };
    });
  }

  async function swap(args: any, extData: any) {
    const sell = Number(args.publicAsset);
    const buy = Number(args.swapAsset);
    const payout = -BigInt(extData.extAmount); // what the pool pays us in `sell`
    const deliver = BigInt(args.swapAmount); // what we must deliver in `buy`
    if (assets.get(buy)!.address === null && deliver % WEI_PER_PLANCK !== 0n) throw new Error("native amounts must be whole planck");
    return exclusive(async () => {
      // buy exactly `deliver` on the exchange, spending at most what the pool will pay us
      const q = await quoteExactOut(api, dexAsset(sell), dexAsset(buy), toDex(buy, deliver), 0);
      const maxIn = toDex(sell, payout);
      if (q.amountIn > maxIn) throw Object.assign(new Error("price moved; request a new quote"), { status: 409 });
      const calls = [swapCall(api, { ...q, limit: maxIn }, account)];
      const token = assets.get(buy)!.address;
      if (token !== null) {
        calls.push(await buildReviveCall(api, account, token, ERC20.encodeFunctionData("approve", [pool, deliver]), 0n, { abi: ERC20_ABI }));
      }
      calls.push(await transactCall(args, extData, token === null ? deliver : 0n, true));
      const r = await sendNative(api, account, calls, { pair });
      return { blockHash: r.blockHash, txHash: r.txHash };
    });
  }

  return { account, evm: ethers.getAddress(evm), api, fees, quoteSwap, transact, swap };
}
