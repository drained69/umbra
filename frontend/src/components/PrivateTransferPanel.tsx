import { useState } from "react";
import { ethers } from "ethers";
import { Keypair, Utxo, toUnits } from "@umbra/sdk";
import { NATIVE } from "../lib/chain";
import { logActivity, validShielded } from "../lib/finance";
import { usePrivateAccount } from "../lib/privateAccount";
import { submitShielded } from "../lib/shielded";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";
import CopyButton from "./CopyButton";

type Action = "deposit" | "send" | "withdraw";

export default function PrivateTransferPanel({ wallet }: { wallet: Wallet }) {
  const pa = usePrivateAccount();
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; message: string; href?: string } | null>(null);

  async function submit() {
    if (!pa.owner || !pa.backedUp) return;
    setBusy(true);
    setStatus(null);
    try {
      const value = toUnits(amount, 18);
      if (value <= 0n) throw new Error("Enter an amount greater than zero.");
      let plan;
      if (action === "deposit") {
        plan = { inputs: [], outputs: [new Utxo({ amount: value, keypair: pa.owner })], owner: pa.owner, extAmount: value };
      } else if (action === "send") {
        if (!validShielded(recipient)) throw new Error("Enter the recipient's umbra-addr- address.");
        Keypair.publicFromAddress(recipient.trim());
        plan = await pa.client.planPayment({ source: "private", owner: pa.owner, to: recipient.trim(), amount: value, memo: memo.trim() || undefined });
      } else {
        if (!ethers.isAddress(recipient.trim())) throw new Error("Enter a valid 0x withdrawal address.");
        plan = await pa.client.planWithdrawal(pa.owner, value, ethers.getAddress(recipient.trim()));
      }
      const ref = await submitShielded(wallet, pa.client, plan, (m) => setStatus({ kind: "info", message: m }));
      await pa.refresh();
      logActivity({ kind: action === "deposit" ? "shield" : action === "send" ? "send" : "withdraw", title: `${action === "deposit" ? "Deposited" : action === "send" ? "Sent" : "Withdrew"} ${amount} ${NATIVE}${action === "send" ? " privately" : ""}`, detail: memo || undefined, href: ref.href, private: action === "send" });
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
      <h2>Move private {NATIVE}</h2>
      <p className="hint">Deposit any amount, send to another private address, or withdraw to a 0x wallet. Deposits and withdrawals are public at the pool boundary.</p>
      <div className="denoms">{(["deposit", "send", "withdraw"] as Action[]).map((item) => <button key={item} className={`chip ${action === item ? "active" : ""}`} aria-pressed={action === item} onClick={() => { setAction(item); setStatus(null); }}>{item === "send" ? "Send privately" : item === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
      <label htmlFor="private-amount" style={{ display: "block", marginTop: 16 }}>Amount in {NATIVE}</label>
      <input id="private-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" />
      {action !== "deposit" && <><label htmlFor="private-recipient">{action === "send" ? "Recipient’s private address" : "Recipient’s 0x address"}</label><textarea id="private-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={action === "send" ? "umbra-addr-…" : "0x…"} spellCheck={false} autoCapitalize="off" /></>}
      {action === "send" && <><label htmlFor="private-memo">Note (encrypted to the recipient)</label><input id="private-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Rent for May" maxLength={60} /><p className="hint">The recipient, amount and note are encrypted in the pool. Your gas-paying wallet remains visible on-chain.</p></>}
      {pa.owner && !pa.backedUp && <p className="hint">Confirm you saved the spend key before moving funds.</p>}
      <button className="primary" onClick={submit} disabled={!pa.owner || !pa.backedUp || !amount.trim() || (action !== "deposit" && !recipient.trim()) || busy}>{busy ? "Working…" : action === "send" ? "Send privately" : action === "deposit" ? "Deposit to private account" : "Withdraw"}</button>
      {status && <div className={`status ${status.kind}`} role={status.kind === "err" ? "alert" : "status"}>{status.message} {status.href && <a href={status.href} target="_blank" rel="noreferrer">View block ↗</a>}</div>}
    </div>
  </div>;
}
