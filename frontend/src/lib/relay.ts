import { useEffect, useState } from "react";
import { getRelayerQuote, type RelayerQuote } from "@umbra/sdk";
import { DEPLOYMENT } from "./chain";

/** The relayer that submits private-balance transactions, so the user's wallet never signs them. */
export const RELAYER_URL: string = (import.meta as any).env?.VITE_RELAYER_URL || "";

let cached: Promise<RelayerQuote> | null = null;

/** The relayer's current terms (address and fee), checked against this deployment. */
export function relayerQuote(): Promise<RelayerQuote> {
  if (!RELAYER_URL) return Promise.reject(new Error("No relayer is configured for this app."));
  if (!DEPLOYMENT.contracts.shieldedPool) return Promise.reject(new Error("This network has no private pool."));
  cached ??= getRelayerQuote(RELAYER_URL, { chainId: DEPLOYMENT.chainId, pool: DEPLOYMENT.contracts.shieldedPool });
  cached.catch(() => { cached = null; }); // retry on the next call
  return cached;
}

export type RelayerState = { state: "loading" } | { state: "ready"; quote: RelayerQuote } | { state: "down"; error: string };

export function useRelayer(): RelayerState {
  const [s, setS] = useState<RelayerState>({ state: "loading" });
  useEffect(() => {
    let stop = false;
    relayerQuote().then(
      (quote) => { if (!stop) setS({ state: "ready", quote }); },
      (e) => { if (!stop) setS({ state: "down", error: e?.message || String(e) }); }
    );
    return () => { stop = true; };
  }, []);
  return s;
}
