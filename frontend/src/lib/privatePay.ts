import type { RequestAsset } from "@umbra/sdk";
import { useSpendRoute } from "../components/RelayRoute";
import { fmt } from "./finance";
import { maIdFor, useMaRelayer } from "./multi";
import { usePrivateAccount } from "./privateAccount";
import type { Wallet } from "./wallet";

export { maIdFor };

/** Whether payments in `asset` can be received into and sent from a private balance. */
export function privatelyPayable(asset: RequestAsset): boolean {
  return asset.assetId === null || maIdFor(asset) !== null;
}

/**
 * Everything a form needs to pay `units` of `asset` from the private balance: the relayer
 * route and its fee in that asset, the spendable balance, and which pool to use.
 */
export function usePrivateSpend(asset: RequestAsset, units: bigint, wallet: Wallet | null, selfSubmit: boolean) {
  const pa = usePrivateAccount();
  const route = useSpendRoute(wallet, selfSubmit);
  const ma = useMaRelayer();
  const native = asset.assetId === null;
  const id = maIdFor(asset);
  const fee = native ? route.fee : !selfSubmit && ma.state === "ready" && id !== null ? ma.quote.fees[Number(id)] ?? 0n : 0n;
  const balance = native ? pa.spendable : id !== null ? pa.maSpendable(id) : 0n;
  return {
    route,
    fee,
    balance,
    /** relayer fee in the asset's own units, for display */
    feeLabel: native ? undefined : `${fmt(fee, asset.decimals, 2)} ${asset.symbol}`,
    pool: (native ? pa.tpotSource(units + fee) ?? undefined : "multi") as "multi" | "legacy" | undefined,
    canPay: !!pa.owner && units > 0n && id !== null && balance >= units + fee,
  };
}
