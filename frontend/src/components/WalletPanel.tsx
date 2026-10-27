import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { ERC20_ABI, assetErc20Address } from "@umbra/sdk";
import { NATIVE, getApi, readProvider, short } from "../lib/chain";
import { PUSD, fmt, useActivity, useContacts, validShielded, type Contact } from "../lib/finance";
import { usePrivateAccount } from "../lib/privateAccount";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";
import QrCode from "./QrCode";
import CopyButton from "./CopyButton";

interface Props {
  wallet: Wallet;
  onNavigate: (tab: "pay" | "swap", sub?: "send" | "request" | "split" | "requests") => void;
}

/** Balances, receiving, contacts and recent activity. */
export default function WalletPanel({ wallet, onNavigate }: Props) {
  const pa = usePrivateAccount();
  const activity = useActivity();
  const [pub, setPub] = useState<{ native: bigint; nativeDecimals: number; pusd: bigint | null } | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [receive, setReceive] = useState<"public" | "private">("public");
  const myAddress = wallet.kind === "native" ? wallet.account : wallet.address;

  useEffect(() => {
    let stop = false;
    setPub(null);
    setBalanceError(false);
    const timeout = setTimeout(() => { if (!stop) setBalanceError(true); }, 15000);
    (async () => {
      if (wallet.kind === "native") {
        const api = await getApi();
        const acc: any = await api.query.system.account(wallet.account);
        let pusd: bigint | null = null;
        if (PUSD) {
          const a: any = await api.query.assets.account(PUSD.assetId, wallet.account);
          pusd = a.isSome ? a.unwrap().balance.toBigInt() : 0n;
        }
        if (!stop) { setBalanceError(false); setPub({ native: acc.data.free.toBigInt(), nativeDecimals: 14, pusd }); }
      } else {
        const native = await readProvider.getBalance(wallet.address);
        const pusd = PUSD ? await new ethers.Contract(assetErc20Address(PUSD.assetId!), ERC20_ABI, readProvider).balanceOf(wallet.address) : null;
        if (!stop) { setBalanceError(false); setPub({ native, nativeDecimals: 18, pusd: pusd === null ? null : BigInt(pusd) }); }
      }
    })().catch(() => { if (!stop) { setPub(null); setBalanceError(true); } }).finally(() => clearTimeout(timeout));
    return () => { stop = true; clearTimeout(timeout); };
  }, [wallet, activity.length, refreshTick]);

  const received = pa.history.filter((h) => h.text || h.requestId).slice(0, 8);

  return (
    <>
      {balanceError && <div className="status err" role="alert">Couldn’t load your balances. Check your connection and try again. <button onClick={() => setRefreshTick((tick) => tick + 1)}>Retry</button></div>}
      <div className="balance-strip">
        <div><span className="balance-label">{NATIVE} balance</span><strong>{pub ? fmt(pub.native, pub.nativeDecimals, 4) : balanceError ? "Unavailable" : "…"} <small>{NATIVE}</small></strong></div>
        {PUSD && <div><span className="balance-label">pUSD balance</span><strong>{pub?.pusd != null ? fmt(pub.pusd, PUSD.decimals, 4) : balanceError ? "Unavailable" : "…"} <small>pUSD</small></strong></div>}
        <div><span className="balance-label">Private balance</span>{pa.owner
          ? <strong>{pa.balance === null ? "…" : fmt(pa.balance, 18, 4)} <small>{NATIVE}</small></strong>
          : <><strong><small>{pa.locked ? "Locked" : "Not set up"}</small></strong><button className="text-button" onClick={() => document.getElementById("private-account")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{pa.locked ? "Unlock with your passcode" : "Set up a private account"}</button></>}</div>
      </div>

      <div className="quick-actions">
        <button className="primary" onClick={() => onNavigate("pay", "send")}>Send</button>
        <button onClick={() => onNavigate("pay", "request")}>Request</button>
        <button onClick={() => onNavigate("pay", "split")}>Split a bill</button>
        <button onClick={() => onNavigate("swap")}>Swap</button>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Receive</h2>
          <div className="denoms" role="group" aria-label="Receive to">
            <button className={`chip ${receive === "public" ? "active" : ""}`} aria-pressed={receive === "public"} onClick={() => setReceive("public")}>Public address</button>
            <button className={`chip ${receive === "private" ? "active" : ""}`} aria-pressed={receive === "private"} onClick={() => setReceive("private")}>Private address</button>
          </div>
          {receive === "public" ? (
            <div className="receive-box">
              <QrCode value={myAddress} label="QR code of your public address" />
              <div><p className="hint">Anyone can see payments to this address.</p><p className="mono wrap">{myAddress}</p><CopyButton value={myAddress}>Copy address</CopyButton></div>
            </div>
          ) : pa.owner ? (
            <div className="receive-box">
              <QrCode value={pa.owner.address()} label="QR code of your private address" />
              <div><p className="hint">Payments to this address are encrypted. The chain shows neither you as the recipient nor the amount.</p><p className="mono wrap">{short(pa.owner.address())}</p><CopyButton value={pa.owner!.address()}>Copy private address</CopyButton></div>
            </div>
          ) : <p className="hint" style={{ marginTop: 14 }}>Set up a private account to get a private address.</p>}
        </div>
        <PrivateAccountCard />
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title-row"><h2>Activity</h2><button className="text-button" onClick={() => onNavigate("pay", "requests")}>My requests →</button></div>
          {received.length > 0 && <>
            <span className="toolbar-label" style={{ marginTop: 6 }}>Received privately</span>
            <ul className="list">
              {received.map((h) => <li key={h.utxo.index}><span className="tag private">private</span><span className="grow">{h.text || "Payment"}{h.requestId ? " · request" : ""}</span><strong>+{fmt(h.utxo.amount, 18, 4)} {NATIVE}</strong></li>)}
            </ul>
          </>}
          <span className="toolbar-label" style={{ marginTop: 12 }}>Recent</span>
          {activity.length === 0 ? <p className="hint">Payments, requests and swaps you make here will appear in this list.</p> : (
            <ul className="list">
              {activity.slice(0, 12).map((a) => <li key={a.id}><span className={`tag ${a.private ? "private" : ""}`}>{a.kind}</span><span className="grow">{a.title}{a.detail && <small> · {a.detail}</small>}</span>{a.href ? <a href={a.href} target="_blank" rel="noreferrer">view ↗</a> : <small>{new Date(a.at).toLocaleDateString()}</small>}</li>)}
            </ul>
          )}
        </div>
        <ContactsCard />
      </div>
    </>
  );
}

function ContactsCard() {
  const { contacts, save, remove } = useContacts();
  const [draft, setDraft] = useState<Contact>({ id: "", name: "" });
  const [err, setErr] = useState<string | null>(null);

  function add() {
    setErr(null);
    const name = draft.name.trim();
    const account = draft.account?.trim() || undefined;
    const shielded = draft.shielded?.trim() || undefined;
    if (!name) return setErr("Give the contact a name.");
    if (!account && !shielded) return setErr("Add a public address, a private address, or both.");
    if (shielded && !validShielded(shielded)) return setErr("The private address should start with umbra-addr-.");
    if (account && !ethers.isAddress(account) && !/^[1-9A-HJ-NP-Za-km-z]{46,48}$/.test(account)) return setErr("Enter a Portaldot 5… or 0x address.");
    save({ id: draft.id || crypto.randomUUID(), name, account, shielded });
    setDraft({ id: "", name: "" });
  }

  return (
    <div className="card">
      <h2>Contacts</h2>
      <p className="hint">Saved only in this browser, so you can pay and request by name.</p>
      {contacts.length > 0 && <ul className="list">{contacts.map((c) => <li key={c.id}><span className="avatar">{c.name.slice(0, 1).toUpperCase()}</span><span className="grow"><strong>{c.name}</strong><small> {c.shielded ? "private" : ""}{c.shielded && c.account ? " · " : ""}{c.account ? short(c.account) : ""}</small></span><button className="text-button" onClick={() => setDraft(c)}>Edit</button><button className="text-button" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}>×</button></li>)}</ul>}
      <label htmlFor="c-name">{draft.id ? "Edit contact" : "Add a contact"}</label>
      <input id="c-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" maxLength={40} />
      <input aria-label="Public address" value={draft.account ?? ""} onChange={(e) => setDraft({ ...draft, account: e.target.value })} placeholder="Public address: 5… or 0x…" spellCheck={false} style={{ marginTop: 8 }} />
      <input aria-label="Private address" value={draft.shielded ?? ""} onChange={(e) => setDraft({ ...draft, shielded: e.target.value })} placeholder="Private address: umbra-addr-…" spellCheck={false} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={add}>{draft.id ? "Save" : "Add contact"}</button>{draft.id && <button onClick={() => setDraft({ id: "", name: "" })}>Cancel</button>}</div>
      {err && <div className="status err" role="alert">{err}</div>}
    </div>
  );
}
