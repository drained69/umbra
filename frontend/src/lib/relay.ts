import { useEffect, useState } from "react";
import { getRelayerQuote, type RelayerQuote } from "@umbra/sdk";
import { DEPLOYMENT, RELAYER_URL } from "./chain";
import { MA, maRelayerQuote } from "./multi";

export { RELAYER_URL };

let cached: Promise<RelayerQuote> | null = null;

/** The relayer's current terms (address and fee), checked against this deployment. */
export function relayerQuote(): Promise<RelayerQuote> {
  if (!RELAYER_URL) return Promise.reject(new Error("No relayer is configured for this app."));
  if (!DEPLOYMENT.contracts.shieldedPool) return Promise.reject(new Error("This network has no private pool."));
  cached ??= getRelayerQuote(RELAYER_URL, { chainId: DEPLOYMENT.chainId, pool: DEPLOYMENT.contracts.shieldedPool });
  cached.catch(() => { cached = null; }); // retry on the next call
  return cached;
}

export type RelayerState = { state: "loading" } | { state: "ready"; quote: { relayer: string; fee: bigint } } | { state: "down"; error: string };

/** Whether tPOT can be spent privately right now, and the relayer's tPOT fee. */
export function useRelayer(): RelayerState {
  const [s, setS] = useState<RelayerState>({ state: "loading" });
  useEffect(() => {
    let stop = false;
    const terms = MA ? maRelayerQuote().then((q) => ({ relayer: q.relayer, fee: q.fees[0] })) : relayerQuote();
    terms.then(
      (quote) => { if (!stop) setS({ state: "ready", quote }); },
      (e) => { if (!stop) setS({ state: "down", error: e?.message || String(e) }); }
    );
    return () => { stop = true; };
  }, []);
  return s;
}
