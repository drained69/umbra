import { useState } from "react";
import { ethers } from "ethers";
import { Keypair, Utxo, toUnits } from "@umbra/sdk";
import { NATIVE } from "../lib/chain";
import { logActivity, validShielded } from "../lib/finance";
import { usePrivateAccount } from "../lib/privateAccount";
import { spendPrivately, submitShielded } from "../lib/shielded";
import { MA, MA_NATIVE, maClient, proveMulti, spendMulti, submitMultiWithWallet, useMaRelayer } from "../lib/multi";
import { fmt } from "../lib/finance";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";
import CopyButton from "./CopyButton";
import { PrivatePoolMeter } from "./PrivacyMeter";
import RelayRoute, { useSpendRoute } from "./RelayRoute";

type Action = "deposit" | "send" | "withdraw";

export default function PrivateTransferPanel({ wallet }: { wallet: Wallet }) {
  const pa = usePrivateAccount();
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [selfSubmit, setSelfSubmit] = useState(false);
  const route = useSpendRoute(wallet, selfSubmit);
  // with the multi-asset pool, the private balance also holds tokens (pUSD)
  const [assetId, setAssetId] = useState(0);
  const asset = MA ? MA.assets.find((a) => a.id === assetId)! : { id: 0, symbol: NATIVE, decimals: 18, address: null };
  const maRelayer = useMaRelayer();
  const tokenFee = asset.id !== 0 && maRelayer.state === "ready" ? maRelayer.quote.fees[asset.id] ?? null : null;
  const spendRouteReady = asset.id === 0 ? route.ready : selfSubmit || (maRelayer.state === "ready" && tokenFee !== null);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; message: string; href?: string } | null>(null);

  async function submit() {
    if (!pa.owner || !pa.backedUp) return;
    setBusy(true);
    setStatus(null);
    try {
      const value = toUnits(amount, asset.decimals);
      if (value <= 0n) throw new Error("Enter an amount greater than zero.");
      const owner = pa.owner;
      const info = (m: string) => setStatus({ kind: "info", message: m });
      const id = BigInt(asset.id);
      // tPOT can sit in either pool; tokens only in the multi-asset pool
      const pool = id !== MA_NATIVE ? "multi" : pa.tpotSource(value + route.fee) ?? (maClient ? "multi" : "legacy");
      let ref;
      if (action === "deposit") {
        if (maClient) {
          info("Generating a zero-knowledge proof in your browser…");
          ref = await submitMultiWithWallet(wallet, await proveMulti(maClient.planDeposit(owner, id, value)), info);
        } else {
          ref = await submitShielded(wallet, pa.client, { inputs: [], outputs: [new Utxo({ amount: value, keypair: owner })], owner, extAmount: value }, info);
        }
      } else if (action === "send") {
        if (!validShielded(recipient)) throw new Error("Enter the recipient's umbra-addr- address.");
        Keypair.publicFromAddress(recipient.trim());
        const to = recipient.trim(), note = memo.trim() || undefined;
        ref = pool === "multi"
          ? await spendMulti(id, (relay) => maClient!.planPayment({ owner, to, asset: id, amount: value, memo: note, relay }), info, { selfSubmit: route.signer })
          : await spendPrivately(pa.client, (relay) => pa.client.planPayment({ source: "private", owner, to, amount: value, memo: note, relay }), info, { selfSubmit: route.signer });
      } else {
        if (!ethers.isAddress(recipient.trim())) throw new Error("Enter a valid 0x withdrawal address.");
        const to = ethers.getAddress(recipient.trim());
        ref = pool === "multi"
          ? await spendMulti(id, (relay) => maClient!.planWithdrawal(owner, id, value, to, relay), info, { selfSubmit: route.signer })
          : await spendPrivately(pa.client, (relay) => pa.client.planWithdrawal(owner, value, to, relay), info, { selfSubmit: route.signer });
      }
      await pa.refresh();
      logActivity({ kind: action === "deposit" ? "shield" : action === "send" ? "send" : "withdraw", title: `${action === "deposit" ? "Deposited" : action === "send" ? "Sent" : "Withdrew"} ${amount} ${asset.symbol}${action === "send" ? " privately" : ""}`, detail: memo || undefined, href: ref.href, private: action === "send" });
      setAmount("");
      setMemo("");
      setStatus({ kind: "ok", message: `${action === "deposit" ? "Deposited" : action === "send" ? "Sent privately" : "Withdrawn"} · ${ref.label}`, href: ref.href });
    } catch (e: any) {
      setStatus({ kind: "err", message: e?.shortMessage || e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid">
    <div>
      <PrivateAccountCard />
      {pa.owner && <div className="card" style={{ marginTop: 16 }}>
        <label htmlFor="shielded-address" style={{ marginTop: 0 }}>Shareable private address</label>
        <textarea id="shielded-address" readOnly value={pa.owner.address()} />
        <CopyButton className="ghost" value={pa.owner!.address()}>Copy address</CopyButton>
      </div>}
    </div>
    <div className="card">
      <h2>Move private {MA ? "funds" : NATIVE}</h2>
      <p className="hint">Deposit any amount, send to another private address, or withdraw to any wallet. Deposits are signed by your wallet. For sends and withdrawals, choose a relayer or submit from your wallet.</p>
      <PrivatePoolMeter refreshKey={pa.history.length} />
      <div className="denoms">{(["deposit", "send", "withdraw"] as Action[]).map((item) => <button key={item} className={`chip ${action === item ? "active" : ""}`} aria-pressed={action === item} onClick={() => { setAction(item); setStatus(null); }}>{item === "send" ? "Send privately" : item === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
      {MA && <div className="denoms" role="group" aria-label="Asset" style={{ marginTop: 12 }}>{MA.assets.map((a) => <button key={a.id} className={`chip ${assetId === a.id ? "active" : ""}`} aria-pressed={assetId === a.id} onClick={() => { setAssetId(a.id); setAmount(""); setStatus(null); }}>{a.symbol}{pa.owner ? ` · ${pa.balance === null ? pa.error ? "Unavailable" : "Scanning…" : fmt(a.id === 0 ? pa.balance : pa.maBalances.get(BigInt(a.id)) ?? 0n, a.decimals, 4)}` : ""}</button>)}</div>}
      <label htmlFor="private-amount" style={{ display: "block", marginTop: 16 }}>Amount in {asset.symbol}</label>
      <input id="private-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" />
      {action !== "deposit" && <><label htmlFor="private-recipient">{action === "send" ? "Recipient’s private address" : "Recipient’s 0x address"}</label><textarea id="private-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={action === "send" ? "umbra-addr-…" : "0x…"} spellCheck={false} autoCapitalize="off" /></>}
      {action === "send" && <><label htmlFor="private-memo">Note (encrypted to the recipient)</label><input id="private-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Rent for May" maxLength={60} /><p className="hint">The recipient, amount and note are encrypted in the pool.</p></>}
      {action === "withdraw" && <p className="hint">The amount and the 0x address are public when they leave the pool. Withdraw to a fresh address that has never been linked to you.</p>}
      {action !== "deposit" && (asset.id === 0 ? <RelayRoute relayer={route.relayer} wallet={wallet} selfSubmit={selfSubmit} onSelfSubmit={setSelfSubmit} /> : <>
        {!selfSubmit && maRelayer.state === "loading" && <p className="hint">Checking the {asset.symbol} relayer and fee…</p>}
        {!selfSubmit && maRelayer.state === "down" && <div className="status err" role="alert">The {asset.symbol} relayer is unavailable. You can submit from your wallet, which reveals your account as the sender.</div>}
        {!selfSubmit && maRelayer.state === "ready" && tokenFee === null && <div className="status err" role="alert">The relayer has no fee quote for {asset.symbol}. Choose wallet submission or try again later.</div>}
        {!selfSubmit && maRelayer.state === "ready" && tokenFee !== null && <p className="privacy-note private">Umbra's relayer submits this transaction, so your wallet does not sign it. The withdrawal address and amount remain public, and timing can still link activity. Fee: {fmt(tokenFee, asset.decimals, 4)} {asset.symbol}, taken from your private balance.</p>}
        <label className="check-row"><input type="checkbox" checked={selfSubmit} onChange={(e) => setSelfSubmit(e.target.checked)} />Submit from my wallet instead. My account will be visible as the sender.</label>
      </>)}
      {action === "withdraw" && asset.id !== 0 && <p className="hint">The receiving account needs a little {NATIVE} first: Portaldot accounts can't hold {asset.symbol} without it.</p>}
      {pa.owner && !pa.backedUp && <p className="hint">Confirm you saved the spend key before moving funds.</p>}
      <button className="primary" onClick={submit} disabled={!pa.owner || !pa.backedUp || !amount.trim() || (action !== "deposit" && (!recipient.trim() || !spendRouteReady)) || busy}>{busy ? "Working…" : action === "send" ? "Send privately" : action === "deposit" ? "Deposit to private account" : "Withdraw"}</button>
      {status && <div className={`status ${status.kind}`} role={status.kind === "err" ? "alert" : "status"}>{status.message} {status.href && <a href={status.href} target="_blank" rel="noreferrer">View block ↗</a>}</div>}
    </div>
  </div>;
}
