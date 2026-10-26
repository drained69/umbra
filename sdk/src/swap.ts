// Swaps on Portaldot's native DEX (pallet-asset-conversion, verified on portaldot-v3 spec
// 3002): quotes from the `AssetConversionApi` runtime API, then a slippage-bounded swap
// extrinsic signed by a native account. Amounts are raw units: planck (14 decimals) for the
// native token, the asset's own decimals (pUSD: 6) for pallet-assets tokens.

import type { ApiPromise } from "@polkadot/api";
import type { SubmittableExtrinsic } from "@polkadot/api/types";

/** "native" = tPOT/POT; a number = a pallet-assets id (e.g. 7777 for pUSD). */
export type DexAsset = "native" | number;

const kind = (a: DexAsset) => (a === "native" ? { Native: null } : { WithId: a });
const BPS = 10_000n;

const optionBig = (o: any): bigint | null => (o?.isSome ? BigInt(o.unwrap().toString()) : null);

/** Pool reserves as [reserve of `a`, reserve of `b`], or null if there is no pool. */
export async function getReserves(api: ApiPromise, a: DexAsset, b: DexAsset): Promise<[bigint, bigint] | null> {
  const r: any = await (api.call as any).assetConversionApi.getReserves(kind(a), kind(b));
  if (!r?.isSome) return null;
  const [ra, rb] = r.unwrap();
  return [BigInt(ra.toString()), BigInt(rb.toString())];
}

/** The pool's LP fee in basis points (`lpFee` is parts per million here: 3000 = 0.3%, matching live quotes). */
export function lpFeeBps(api: ApiPromise): number {
  return Number((api.consts as any).assetConversion.lpFee.toString()) / 100;
}

export interface SwapQuote {
  from: DexAsset;
  to: DexAsset;
  /** "exactIn": `amountIn` is fixed; "exactOut": `amountOut` is fixed */
  mode: "exactIn" | "exactOut";
  amountIn: bigint;
  amountOut: bigint;
  /** limit sent with the swap: minimum out (exactIn) or maximum in (exactOut) */
  limit: bigint;
  /** execution price vs the pool's spot price, fee included, in basis points */
  priceImpactBps: number;
  feeBps: number;
  reserves: [bigint, bigint];
}

function impactBps(amountIn: bigint, amountOut: bigint, [rin, rout]: [bigint, bigint]): number {
  if (amountIn === 0n || rin === 0n || rout === 0n) return 0;
  // 1 - (amountOut / amountIn) / (rout / rin)
  const ratio = (amountOut * rin * BPS) / (amountIn * rout);
  return Number(BPS - ratio);
}

/** Quote swapping exactly `amountIn` of `from`. */
export async function quoteExactIn(api: ApiPromise, from: DexAsset, to: DexAsset, amountIn: bigint, slippageBps: number): Promise<SwapQuote> {
  const reserves = await getReserves(api, from, to);
  if (!reserves) throw new Error("there is no liquidity pool for this pair");
  const out = optionBig(await (api.call as any).assetConversionApi.quotePriceExactTokensForTokens(kind(from), kind(to), amountIn, true));
  if (out === null || out === 0n) throw new Error("the pool cannot fill this amount");
  return {
    from, to, mode: "exactIn", amountIn, amountOut: out,
    limit: (out * (BPS - BigInt(slippageBps))) / BPS,
    priceImpactBps: impactBps(amountIn, out, reserves),
    feeBps: lpFeeBps(api),
    reserves,
  };
}

/** Quote receiving exactly `amountOut` of `to`. */
export async function quoteExactOut(api: ApiPromise, from: DexAsset, to: DexAsset, amountOut: bigint, slippageBps: number): Promise<SwapQuote> {
  const reserves = await getReserves(api, from, to);
  if (!reserves) throw new Error("there is no liquidity pool for this pair");
  if (amountOut >= reserves[1]) throw new Error("the pool does not hold that much");
  const amountIn = optionBig(await (api.call as any).assetConversionApi.quotePriceTokensForExactTokens(kind(from), kind(to), amountOut, true));
  if (amountIn === null) throw new Error("the pool cannot fill this amount");
  return {
    from, to, mode: "exactOut", amountIn, amountOut,
    limit: (amountIn * (BPS + BigInt(slippageBps)) + BPS - 1n) / BPS,
    priceImpactBps: impactBps(amountIn, amountOut, reserves),
    feeBps: lpFeeBps(api),
    reserves,
  };
}

/**
 * The swap extrinsic for a quote. The runtime enforces `quote.limit`, so a price move beyond
 * the slippage tolerance fails the swap (and any `utility.batchAll` it is part of).
 * `keepAlive` keeps the payer above the existential deposit.
 */
export function swapCall(api: ApiPromise, quote: SwapQuote, sendTo: string): SubmittableExtrinsic<"promise"> {
  const path = [kind(quote.from), kind(quote.to)];
  return (
    quote.mode === "exactIn"
      ? api.tx.assetConversion.swapExactTokensForTokens(path, quote.amountIn, quote.limit, sendTo, true)
      : api.tx.assetConversion.swapTokensForExactTokens(path, quote.amountOut, quote.limit, sendTo, true)
  ) as SubmittableExtrinsic<"promise">;
}
