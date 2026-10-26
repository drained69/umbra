import { useEffect, useState } from "react";
import { quotePrivateSwap, relayMultiAsset, toUnits, type PrivateSwapQuote } from "@umbra/sdk";
import { blockLink, short } from "../lib/chain";
import { fmt, logActivity } from "../lib/finance";
import { MA, maClient, proveMulti, useMaRelayer } from "../lib/multi";
import { usePrivateAccount } from "../lib/privateAccount";
import PrivateAccountCard from "./PrivateAccountCard";

type Status = { t: "ok" | "err" | "info"; m: string; href?: string } | null;

/**
 * A swap entirely inside the private balance: the trader's notes pay the relayer, which buys
 * the other asset on Portaldot's exchange and delivers it as a new private note, all in one
 * atomic transaction the relayer submits. No wallet signs; the chain shows only the relayer.
 */
export default function PrivateSwap() {
  const pa = usePrivateAccount();
  const relayer = useMaRelayer();
  const assets = MA!.assets;
  const [sell, setSell] = useState(assets[0].id);
  const buy = assets.find((a) => a.id !== sell)!.id;
  const sellA = assets.find((a) => a.id === sell)!;
  const buyA = assets.find((a) => a.id === buy)!;
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<PrivateSwapQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [ackImpact, setAckImpact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    setAckImpact(false);
    if (!amount.trim() || relayer.state !== "ready") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const amountIn = toUnits(amount, sellA.decimals);
        if (amountIn <= 0n) return;
        const q = await quotePrivateSwap(relayer.quote, sell, buy, amountIn);
        if (!cancelled) setQuote(q);
      } catch (e: any) {
        if (!cancelled) setQuoteErr(e?.message || String(e));
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amount, sell, relayer.state, tick]);

  const available = pa.owner ? pa.maSpendable(BigInt(sell)) : 0n;
  const need = quote ? quote.amountIn + quote.fee : 0n;
  const tooMuch = !!quote && need > available;
  const impact = quote ? quote.priceImpactBps / 100 : 0;

  async function swap() {
    if (!quote || !pa.owner || relayer.state !== "ready") return;
    setBusy(true);
    setStatus(null);
    try {
      const plan = await maClient!.planSwap({
        owner: pa.owner,
        sell: BigInt(sell),
        buy: BigInt(buy),
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        relay: { relayer: relayer.quote.relayer, fee: quote.fee },
        memo: "Swap",
      });
      setStatus({ t: "info", m: "Generating a zero-knowledge proof in your browser…" });
      const prepared = await proveMulti(plan);
      setStatus({ t: "info", m: "The relayer is trading and settling it. Nothing for your wallet to sign…" });
      const r = await relayMultiAsset(relayer.quote, prepared);
      logActivity({ kind: "swap", title: `Swapped ${fmt(quote.amountIn, sellA.decimals)} ${sellA.symbol} → ${fmt(quote.amountOut, buyA.decimals)} ${buyA.symbol}`, detail: "private", href: blockLink(r.blockHash), private: true });
      setStatus({ t: "ok", m: `Swapped privately · relayed in block ${short(r.blockHash)}`, href: blockLink(r.blockHash) });
      setAmount("");
      pa.refresh();
    } catch (e: any) {
      const msg = e?.message || String(e);
      setStatus({ t: "err", m: /price moved/i.test(msg) ? "The price moved before the relayer could fill it, so nothing happened. Check the new quote and try again." : msg });
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card swap-card">
        <fieldset disabled={busy} className="swap-controls">
          <h2>Private swap</h2>
          <p className="hint">Trade inside your private balance. The relayer buys on Portaldot's exchange and your new {buyA.symbol} arrives as a private note, in one transaction it submits for you.</p>
          <div className="swap-leg">
            <div className="row" style={{ justifyContent: "space-between" }}><span className="toolbar-label">YOU SELL</span><span className="hint">Private: {fmt(available, sellA.decimals, 4)} {sellA.symbol}</span></div>
            <div className="row"><input aria-label={`Amount of ${sellA.symbol} to sell`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" /><span className="asset-badge">{sellA.symbol}</span></div>
          </div>
          <button className="flip" aria-label="Swap direction" onClick={() => { setSell(buy); setAmount(""); }}>⇅</button>
          <div className="swap-leg">
            <span className="toolbar-label">YOU RECEIVE (EXACTLY)</span>
            <div className="row"><strong className="swap-out">{quote ? fmt(quote.amountOut, buyA.decimals, 6) : "—"}</strong><span className="asset-badge">{buyA.symbol}</span></div>
          </div>
          {quote && <dl className="quote">
            <div><dt>Rate</dt><dd>1 {sellA.symbol} ≈ {(Number(quote.amountOut) / 10 ** buyA.decimals / (Number(quote.amountIn) / 10 ** sellA.decimals)).toPrecision(5)} {buyA.symbol}</dd></div>
            <div><dt>Relayer fee</dt><dd>{fmt(quote.fee, sellA.decimals, 4)} {sellA.symbol}</dd></div>
            <div><dt>Total from your private balance</dt><dd>{fmt(need, sellA.decimals, 4)} {sellA.symbol}</dd></div>
            <div><dt>Price impact</dt><dd className={impact > 3 ? "warn" : ""}>{impact.toFixed(2)}%</dd></div>
          </dl>}
          {relayer.state === "down" && <div className="status err" role="alert">The relayer isn't reachable, so private swaps are unavailable. {relayer.error}</div>}
          {quoteErr && <div className="status err" role="alert">{quoteErr}</div>}
          {impact > 5 && <label className="row check-row"><input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} />I accept a {impact.toFixed(1)}% price impact (this pool is small)</label>}
          <p className="privacy-note private">Hidden: who traded. Your wallet never signs, and the chain shows the relayer trading on the exchange. The traded amounts are visible there, but not linked to you.</p>
          <button className="primary" onClick={swap} disabled={busy || !pa.owner || !quote || tooMuch || (impact > 5 && !ackImpact)}>
            {busy ? "Working…" : !pa.owner ? "Open your private account first" : tooMuch ? `Not enough private ${sellA.symbol}` : `Swap ${sellA.symbol} for ${buyA.symbol} privately`}
          </button>
        </fieldset>
        {status && <div className={`status ${status.t}`} role={status.t === "err" ? "alert" : "status"}>{status.m} {status.href && <a href={status.href} target="_blank" rel="noreferrer">view ↗</a>}</div>}
      </div>
      <PrivateAccountCard compact />
    </div>
  );
}
