import { useEffect, useState } from "react";
import { evmAddressOf, quoteExactIn, quoteExactOut, sendNative, swapCall, toUnits, type SwapQuote } from "@umbra/sdk";
import { NATIVE, blockLink, getApi, short } from "../lib/chain";
import { NATIVE_PLANCK_DECIMALS, PUSD, fmt, logActivity } from "../lib/finance";
import { usePrivateAccount } from "../lib/privateAccount";
import { proveShielded, shieldedCall } from "../lib/shielded";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";

type Status = { t: "ok" | "err" | "info"; m: string; href?: string } | null;
const SLIPPAGES = [50, 100, 200];
const WEI_PER_PLANCK = 10n ** 4n; // EVM amounts are planck × 10^4

/**
 * tPOT ↔ pUSD on Portaldot's native DEX (pallet-asset-conversion). Beyond plain wallet swaps,
 * the private balance can fund a swap (withdraw + swap) or receive one (swap + deposit) — each
 * as ONE atomic extrinsic: if the price moves past the slippage limit, nothing happens.
 */
export default function SwapPanel({ wallet }: { wallet: Wallet }) {
  if (wallet.kind !== "native" || !PUSD) {
    return <div className="notice-card"><span>ⓘ</span><div><strong>{PUSD ? "Connect the Portaldot Extension to swap" : "No pUSD on this network"}</strong><p>{PUSD ? "Swaps use Portaldot's built-in DEX, which is called from a native Portaldot account." : "There is no pUSD asset to swap with here."}</p></div></div>;
  }
  return <NativeSwap wallet={wallet} />;
}

function NativeSwap({ wallet }: { wallet: Extract<Wallet, { kind: "native" }> }) {
  const pa = usePrivateAccount();
  const [sell, setSell] = useState<"native" | "pusd">("native");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [route, setRoute] = useState<"wallet" | "private">("wallet");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [balances, setBalances] = useState<{ native: bigint; pusd: bigint } | null>(null);
  const [ackImpact, setAckImpact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [tick, setTick] = useState(0);
  const account = wallet.account;
  const pusd = PUSD!;
  const sellSym = sell === "native" ? NATIVE : "pUSD";
  const buySym = sell === "native" ? "pUSD" : NATIVE;
  const dec = (a: "native" | number) => (a === "native" ? NATIVE_PLANCK_DECIMALS : pusd.decimals);
  const privateRoute = route === "private" && !!pa.owner;

  useEffect(() => {
    let stop = false;
    (async () => {
      const api = await getApi();
      const acc: any = await api.query.system.account(account);
      const a: any = await api.query.assets.account(pusd.assetId!, account);
      if (!stop) setBalances({ native: acc.data.free.toBigInt(), pusd: a.isSome ? a.unwrap().balance.toBigInt() : 0n });
    })().catch(() => {});
    return () => { stop = true; };
  }, [account, tick]);

  // Live quote (debounced). Buying tPOT into the private balance quotes exact-out, because the
  // deposit proof must commit to the exact amount received.
  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    setAckImpact(false);
    if (!amount.trim()) return;
    const timer = setTimeout(async () => {
      try {
        const api = await getApi();
        const from = sell === "native" ? "native" : pusd.assetId!;
        const to = sell === "native" ? pusd.assetId! : "native";
        const amountIn = toUnits(amount, dec(from));
        let q = await quoteExactIn(api, from, to, amountIn, slippage);
        if (sell === "pusd" && privateRoute) q = await quoteExactOut(api, from, to, q.limit, slippage);
        setQuote(q);
      } catch (e: any) {
        setQuoteErr(e.message);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [amount, sell, slippage, privateRoute, tick]);

  const impact = quote ? quote.priceImpactBps / 100 : 0;
  const sellBalance = sell === "native" ? (privateRoute ? pa.spendable / WEI_PER_PLANCK : balances?.native ?? 0n) : balances?.pusd ?? 0n;
  const needs = quote ? (quote.mode === "exactIn" ? quote.amountIn : quote.limit) : 0n;
  const short_ = quote && needs > sellBalance;

  async function swap() {
    if (!quote) return;
    setBusy(true);
    setStatus(null);
    try {
      const api = await getApi();
      const calls = [];
      if (privateRoute && sell === "native") {
        // withdraw exactly the sold amount from the private balance to this account, then swap it
        setStatus({ t: "info", m: "Generating a zero-knowledge proof for the withdrawal…" });
        const me = await evmAddressOf(api, account);
        const prepared = await proveShielded(pa.client, await pa.client.planWithdrawal(pa.owner!, quote.amountIn * WEI_PER_PLANCK, me));
        calls.push(await shieldedCall(account, prepared), swapCall(api, quote, account));
      } else if (privateRoute) {
        // swap for an exact tPOT amount, then deposit exactly that into the private balance
        setStatus({ t: "info", m: "Generating a zero-knowledge proof for the deposit…" });
        const plan = await pa.client.planPayment({ source: "wallet", owner: pa.owner, to: pa.owner!.address(), amount: quote.amountOut * WEI_PER_PLANCK, memo: "Swap" });
        const prepared = await proveShielded(pa.client, plan);
        calls.push(swapCall(api, quote, account), await shieldedCall(account, prepared, { dependsOnEarlierCalls: true }));
      } else {
        calls.push(swapCall(api, quote, account));
      }
      setStatus({ t: "info", m: `Sign the swap in the Portaldot Extension (${calls.length > 1 ? "one transaction, both steps or neither" : "one transaction"})…` });
      const r = await sendNative(api, account, calls, { signer: wallet.signer });
      const got = quote.mode === "exactIn" ? `≥ ${fmt(quote.limit, dec(quote.to))}` : fmt(quote.amountOut, dec(quote.to));
      logActivity({ kind: "swap", title: `Swapped ${fmt(quote.mode === "exactIn" ? quote.amountIn : quote.limit, dec(quote.from))} ${sellSym} → ${got} ${buySym}`, detail: privateRoute ? (sell === "native" ? "from private balance" : "into private balance") : undefined, href: blockLink(r.blockHash), private: privateRoute });
      setStatus({ t: "ok", m: `Swapped in block ${short(r.blockHash)}`, href: blockLink(r.blockHash) });
      setAmount("");
      setTick((t) => t + 1);
      if (privateRoute) pa.refresh();
    } catch (e: any) {
      setStatus({ t: "err", m: /Slippage|ProvidedMinimumNotSufficient|ProvidedMaximumNotSufficient/i.test(e?.message ?? "") ? "The price moved beyond your slippage limit, so nothing was swapped. Try again." : e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card swap-card">
        <h2>Swap</h2>
        <p className="hint">Trades against Portaldot's built-in DEX pool. Quotes are live from the chain.</p>
        <div className="swap-leg">
          <div className="row" style={{ justifyContent: "space-between" }}><span className="toolbar-label">YOU SELL</span><button className="text-button" onClick={() => setAmount(sell === "native" && !privateRoute ? fmtPlain(sellBalance > 2n * 10n ** 13n ? sellBalance - 2n * 10n ** 13n : 0n, 14) : fmtPlain(sellBalance, dec(sell === "native" ? "native" : 7777)))}>Balance: {fmt(sellBalance, dec(sell === "native" ? "native" : 7777), 4)} {sellSym}{privateRoute && sell === "native" ? " (private)" : ""}</button></div>
          <div className="row"><input aria-label={`Amount of ${sellSym} to sell`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" /><span className="asset-badge">{sellSym}</span></div>
        </div>
        <button className="flip" aria-label="Swap direction" onClick={() => { setSell(sell === "native" ? "pusd" : "native"); setAmount(""); }}>⇅</button>
        <div className="swap-leg">
          <span className="toolbar-label">YOU RECEIVE{quote?.mode === "exactOut" ? " (EXACTLY)" : " (ESTIMATED)"}</span>
          <div className="row"><strong className="swap-out">{quote ? fmt(quote.amountOut, dec(quote.to), 6) : "—"}</strong><span className="asset-badge">{buySym}</span></div>
        </div>

        {pa.owner && <>
          <span className="toolbar-label" style={{ marginTop: 14 }}>{sell === "native" ? "PAY WITH" : "RECEIVE INTO"}</span>
          <div className="denoms">
            <button className={`chip ${!privateRoute ? "active" : ""}`} onClick={() => setRoute("wallet")}>Wallet</button>
            <button className={`chip ${privateRoute ? "active" : ""}`} onClick={() => setRoute("private")}>Private balance</button>
          </div>
        </>}

        <span className="toolbar-label" style={{ marginTop: 14 }}>SLIPPAGE LIMIT</span>
        <div className="denoms">{SLIPPAGES.map((s) => <button key={s} className={`chip ${slippage === s ? "active" : ""}`} onClick={() => setSlippage(s)}>{s / 100}%</button>)}</div>

        {quote && <dl className="quote">
          <div><dt>Rate</dt><dd>1 {sellSym} ≈ {(Number(quote.amountOut) / 10 ** dec(quote.to) / (Number(quote.amountIn) / 10 ** dec(quote.from))).toPrecision(5)} {buySym}</dd></div>
          {quote.mode === "exactIn" ? <div><dt>Minimum received</dt><dd>{fmt(quote.limit, dec(quote.to))} {buySym}</dd></div> : <div><dt>Maximum sold</dt><dd>{fmt(quote.limit, dec(quote.from))} {sellSym}</dd></div>}
          <div><dt>Price impact</dt><dd className={impact > 3 ? "warn" : ""}>{impact.toFixed(2)}%</dd></div>
          <div><dt>Pool fee</dt><dd>{(quote.feeBps / 100).toFixed(2)}%</dd></div>
          <div><dt>Pool liquidity</dt><dd>{fmt(quote.reserves[0], dec(quote.from), 2)} {sellSym} / {fmt(quote.reserves[1], dec(quote.to), 2)} {buySym}</dd></div>
        </dl>}
        {quoteErr && <div className="status err" role="alert">{quoteErr}</div>}
        {impact > 5 && <label className="row check-row"><input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} />I accept a {impact.toFixed(1)}% price impact (this pool is small)</label>}
        <p className={`privacy-note ${privateRoute ? "private" : ""}`}>
          {!privateRoute ? "A public swap: your account, the amounts and the pool trade are visible." : sell === "native" ? "Your private notes fund the swap. The chain shows your account withdrawing and swapping this amount, but not which deposit the funds came from." : "The tPOT you buy goes straight into your private balance as an encrypted note. The swap itself is public."}
        </p>
        <button className="primary" onClick={swap} disabled={busy || !quote || !!short_ || (impact > 5 && !ackImpact)}>{busy ? "Working…" : short_ ? `Not enough ${sellSym}` : `Swap ${sellSym} for ${buySym}`}</button>
        <StatusLine s={status} />
      </div>
      {pa.owner ? <PrivateAccountCard compact /> : <div className="card"><h2>Private swaps</h2><p className="hint">With a private account, a swap can draw from your private balance or deliver straight into it, in one atomic transaction.</p><PrivateAccountCard compact /></div>}
    </div>
  );
}

function fmtPlain(units: bigint, decimals: number): string {
  const s = (Number(units) / 10 ** decimals).toFixed(Math.min(decimals, 6));
  return s.replace(/\.?0+$/, "");
}

function StatusLine({ s }: { s: Status }) {
  if (!s) return null;
  return <div className={`status ${s.t}`} role={s.t === "err" ? "alert" : "status"}>{s.m} {s.href && <a href={s.href} target="_blank" rel="noreferrer">view ↗</a>}</div>;
}
