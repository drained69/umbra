import { NATIVE } from "../lib/chain";
import { fmt } from "../lib/finance";
import { useRelayer, type RelayerState } from "../lib/relay";
import type { Wallet } from "../lib/wallet";

/** How a private-balance spend will be submitted, with the relayer fee it costs. */
export function useSpendRoute(wallet: Wallet | null, selfSubmit: boolean) {
  const relayer = useRelayer();
  const relayed = relayer.state === "ready" && !selfSubmit;
  return {
    relayer,
    fee: relayed && relayer.state === "ready" ? relayer.quote.fee : 0n,
    /** the wallet that signs, or null when the relayer submits */
    signer: relayed ? null : selfSubmit ? wallet : null,
    ready: relayed || (selfSubmit && !!wallet),
  };
}

export default function RelayRoute({ relayer, wallet, selfSubmit, onSelfSubmit, fee }: { relayer: RelayerState; wallet: Wallet | null; selfSubmit: boolean; onSelfSubmit: (v: boolean) => void; fee?: string }) {
  if (relayer.state === "loading") return <p className="hint">Checking the relayer…</p>;
  if (relayer.state === "ready" && !selfSubmit) {
    return <p className="privacy-note private">Submitted by the Umbra relayer: your wallet doesn't sign, so nothing on chain points to you. Relayer fee {fee ?? `${fmt(relayer.quote.fee, 18, 2)} ${NATIVE}`}, paid from your private balance.</p>;
  }
  return <>
    {relayer.state === "down" && <div className="status err" role="alert">The relayer isn't reachable, so private sends are paused rather than exposing your account. {relayer.error}</div>}
    {wallet && <label className="check-row"><input type="checkbox" checked={selfSubmit} onChange={(e) => onSelfSubmit(e.target.checked)} />Send from my wallet instead. Your account becomes visible as the sender; the recipient and amount stay hidden.</label>}
  </>;
}
