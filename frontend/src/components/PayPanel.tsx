import { useEffect, useMemo, useState } from "react";
import {
  createRequest,
  decodeReceipt,
  decodeRequest,
  encodeReceipt,
  newRequestId,
  requestLink,
  requestMemo,
  splitAmount,
  toUnits,
  verifyReceipt,
  type PaymentRequest,
  type RequestAsset,
} from "@umbra/sdk";
import { DEPLOYMENT, NATIVE, getApi, short } from "../lib/chain";
import { ASSETS, NATIVE_PLANCK_DECIMALS, TPOT, findMyRequest, fmt, logActivity, markRequestPaid, useContacts, useMyName, useMyRequests, validShielded, type StoredRequest } from "../lib/finance";
import { payPrivately, payPublicly } from "../lib/pay";
import { usePrivateAccount } from "../lib/privateAccount";
import type { TxRef } from "../lib/shielded";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";
import QrCode from "./QrCode";

export type PaySub = "send" | "request" | "split" | "requests";
type Status = { t: "ok" | "err" | "info"; m: string; href?: string } | null;

interface Props {
  wallet: Wallet | null;
  sub: PaySub;
  onSub: (s: PaySub) => void;
  /** encoded request from a `?pay=` link */
  payParam: string | null;
  /** encoded receipt from a `?receipt=` link */
  receiptParam: string | null;
  onConnect: () => void;
  onClearLink: () => void;
}

const appUrl = () => `${location.origin}${location.pathname}`;
const shareText = (r: PaymentRequest) => `${r.name || "I"} requested ${r.amount} ${r.asset.symbol}${r.memo ? ` for "${r.memo}"` : ""} on Umbra: ${requestLink(appUrl(), r)}`;

function StatusLine({ s }: { s: Status }) {
  if (!s) return null;
  return <div className={`status ${s.t}`} role={s.t === "err" ? "alert" : "status"}>{s.m} {s.href && <a href={s.href} target="_blank" rel="noreferrer">view ↗</a>}</div>;
}

/** Send, request, split a bill, and track requests; also the page a payment link opens. */
export default function PayPanel({ wallet, sub, onSub, payParam, receiptParam, onConnect, onClearLink }: Props) {
  if (payParam) return <PayRequestView encoded={payParam} wallet={wallet} onConnect={onConnect} onDone={onClearLink} />;
  if (!wallet) return null;
  const tabs: [PaySub, string][] = [["send", "Send"], ["request", "Request"], ["split", "Split a bill"], ["requests", "My requests"]];
  return (
    <>
      <div className="denoms sub-tabs" role="tablist" aria-label="Payment actions">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={sub === id} className={`chip ${sub === id ? "active" : ""}`} onClick={() => onSub(id)}>{label}</button>)}
      </div>
      {sub === "send" && <SendForm wallet={wallet} />}
      {sub === "request" && <RequestForm wallet={wallet} onShowRequests={() => onSub("requests")} />}
      {sub === "split" && <SplitForm wallet={wallet} onShowRequests={() => onSub("requests")} />}
      {sub === "requests" && <RequestsList receiptParam={receiptParam} onClearLink={onClearLink} />}
    </>
  );
}

// ---------------------------------------------------------------- send

function SendForm({ wallet }: { wallet: Wallet }) {
  const pa = usePrivateAccount();
  const { contacts } = useContacts();
  const [to, setTo] = useState("");
  const [toName, setToName] = useState("");
  const [asset, setAsset] = useState<RequestAsset>(TPOT);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [source, setSource] = useState<"private" | "wallet">("private");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const isPrivate = validShielded(to);
  const units = (() => { try { return toUnits(amount, 18); } catch { return 0n; } })();
  const canUsePrivate = !!pa.owner && pa.spendable >= units && units > 0n;
  const effectiveSource = isPrivate ? (source === "private" && canUsePrivate ? "private" : "wallet") : null;

  useEffect(() => { if (isPrivate) setAsset(TPOT); }, [isPrivate]);

  async function send() {
    setBusy(true);
    setStatus(null);
    try {
      const info = (m: string) => setStatus({ t: "info", m });
      if (isPrivate) {
        const ref = await payPrivately(wallet, pa.client, { source: effectiveSource!, owner: pa.owner, to: to.trim(), amount, memo: memo.trim() || undefined }, info);
        logActivity({ kind: "send", title: `Sent ${amount} ${NATIVE} privately${toName ? ` to ${toName}` : ""}`, detail: memo || undefined, href: ref.href, private: true });
        setStatus({ t: "ok", m: `Sent privately · ${ref.label}`, href: ref.href });
        pa.refresh();
      } else {
        const ref = await payPublicly(wallet, { asset, to, amount }, info);
        logActivity({ kind: "send", title: `Sent ${amount} ${asset.symbol}${toName ? ` to ${toName}` : ` to ${short(to.trim())}`}`, href: ref.href });
        setStatus({ t: "ok", m: `Sent · ${ref.label}`, href: ref.href });
      }
      setAmount("");
      setMemo("");
    } catch (e: any) {
      setStatus({ t: "err", m: e?.shortMessage || e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Send</h2>
        <p className="hint">Pay a private address (umbra-addr-…) to keep the recipient hidden, or a public 5…/0x address for an ordinary transfer.</p>
        {contacts.length > 0 && <div className="denoms contact-chips">{contacts.flatMap((c) => [
          c.shielded && <button key={c.id + "s"} className={`chip ${to === c.shielded ? "active" : ""}`} onClick={() => { setTo(c.shielded!); setToName(c.name); }}>{c.name} · private</button>,
          c.account && <button key={c.id + "a"} className={`chip ${to === c.account ? "active" : ""}`} onClick={() => { setTo(c.account!); setToName(c.name); }}>{c.name} · public</button>,
        ].filter(Boolean))}</div>}
        <label htmlFor="send-to">To</label>
        <textarea id="send-to" className="short" value={to} onChange={(e) => { setTo(e.target.value); setToName(""); }} placeholder="umbra-addr-…, 5… or 0x…" spellCheck={false} autoCapitalize="off" />
        <div className="two-col">
          <div><label htmlFor="send-amount">Amount</label><input id="send-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" /></div>
          <div><label htmlFor="send-asset">Asset</label><select id="send-asset" value={asset.symbol} disabled={isPrivate} onChange={(e) => setAsset(ASSETS.find((a) => a.symbol === e.target.value)!)}>{ASSETS.map((a) => <option key={a.symbol}>{a.symbol}</option>)}</select></div>
        </div>
        {isPrivate && <>
          <label htmlFor="send-memo">Note (encrypted, only they can read it)</label>
          <input id="send-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Dinner 🍕" maxLength={60} />
          <span className="toolbar-label" style={{ marginTop: 14 }}>PAY FROM</span>
          <div className="denoms">
            <button className={`chip ${effectiveSource === "private" ? "active" : ""}`} disabled={!canUsePrivate} onClick={() => setSource("private")}>Private balance{pa.owner ? ` (${fmt(pa.spendable, 18, 4)})` : ""}</button>
            <button className={`chip ${effectiveSource === "wallet" ? "active" : ""}`} onClick={() => setSource("wallet")}>Wallet</button>
          </div>
        </>}
        <PrivacyNote mode={isPrivate ? (effectiveSource === "private" ? "private" : "wallet-to-private") : to.trim() ? "public" : null} />
        <button className="primary" onClick={send} disabled={busy || !to.trim() || units <= 0n}>{busy ? "Working…" : isPrivate ? "Send privately" : "Send"}</button>
        <StatusLine s={status} />
      </div>
      <PrivateAccountCard compact />
    </div>
  );
}

function PrivacyNote({ mode }: { mode: "private" | "wallet-to-private" | "public" | null }) {
  if (!mode) return null;
  const text = {
    private: "Hidden: who receives and how much. Visible: that your wallet submitted a private-pool transaction.",
    "wallet-to-private": "Hidden: who receives. Visible: your wallet and the amount, as a deposit into the private pool.",
    public: "Public transfer: anyone can see the sender, recipient and amount.",
  }[mode];
  return <p className={`privacy-note ${mode === "public" ? "" : "private"}`}>{text}</p>;
}

// ---------------------------------------------------------------- request

function useReceiveTargets(wallet: Wallet) {
  const pa = usePrivateAccount();
  const [account, setAccount] = useState<string | null>(wallet.kind === "native" ? wallet.account : null);
  useEffect(() => {
    if (wallet.kind === "native") return setAccount(wallet.account);
    (async () => {
      const api = await getApi();
      setAccount((await (api.call as any).reviveApi.accountId(wallet.address)).toString());
    })().catch(() => setAccount(null));
  }, [wallet]);
  return { shielded: pa.owner?.address() ?? null, account };
}

function RequestShare({ r }: { r: PaymentRequest }) {
  const link = requestLink(appUrl(), r);
  return (
    <div className="share-box">
      <QrCode value={link} label="QR code of the payment link" />
      <div>
        <strong>{r.amount} {r.asset.symbol}{r.memo ? ` · ${r.memo}` : ""}</strong>
        <p className="hint">Send this link to your friend. Opening it lets them pay you {r.to.shielded ? "privately" : "publicly"} in a few clicks.</p>
        <div className="row">
          <button className="primary" onClick={() => navigator.clipboard.writeText(link)}>Copy link</button>
          {"share" in navigator && <button onClick={() => navigator.share({ title: "Payment request", text: shareText(r) }).catch(() => {})}>Share…</button>}
        </div>
      </div>
    </div>
  );
}

function RequestForm({ wallet, onShowRequests }: { wallet: Wallet; onShowRequests: () => void }) {
  const pa = usePrivateAccount();
  const targets = useReceiveTargets(wallet);
  const { add } = useMyRequests();
  const [name, setName] = useMyName();
  const [asset, setAsset] = useState<RequestAsset>(TPOT);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [who, setWho] = useState("");
  const [privately, setPrivately] = useState(true);
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const privateOk = asset.assetId === null && !!targets.shielded;

  function create() {
    setErr(null);
    try {
      const usePrivate = privately && privateOk;
      if (!usePrivate && !targets.account) throw new Error("Your public account is still loading.");
      // public payments of the native token move 14-decimal units; keep requests payable both ways
      if (asset.assetId === null) toUnits(amount.trim(), NATIVE_PLANCK_DECIMALS);
      const r = createRequest({
        chainId: Number(DEPLOYMENT.chainId),
        asset,
        amount: amount.trim(),
        // private requests also list the public account, so a friend without tPOT in a private account can still pay
        to: { ...(usePrivate ? { shielded: targets.shielded! } : {}), ...(targets.account ? { account: targets.account } : {}) },
        name: name.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      add([{ request: r, who: who.trim() || undefined, status: "open" }]);
      logActivity({ kind: "request", title: `Requested ${r.amount} ${r.asset.symbol}${who ? ` from ${who}` : ""}`, detail: r.memo, private: !!r.to.shielded });
      setCreated(r);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Request money</h2>
        <p className="hint">Create a link or QR code. Nothing goes on chain until your friend pays.</p>
        <div className="two-col">
          <div><label htmlFor="rq-amount">Amount</label><input id="rq-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" /></div>
          <div><label htmlFor="rq-asset">Asset</label><select id="rq-asset" value={asset.symbol} onChange={(e) => setAsset(ASSETS.find((a) => a.symbol === e.target.value)!)}>{ASSETS.map((a) => <option key={a.symbol}>{a.symbol}</option>)}</select></div>
        </div>
        <label htmlFor="rq-memo">What for</label>
        <input id="rq-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Concert tickets" maxLength={60} />
        <div className="two-col">
          <div><label htmlFor="rq-name">Your name</label><input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alice" maxLength={40} /></div>
          <div><label htmlFor="rq-who">From (for your list)</label><input id="rq-who" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Bob" maxLength={40} /></div>
        </div>
        <label className="row check-row"><input type="checkbox" checked={privately && privateOk} disabled={!privateOk} onChange={(e) => setPrivately(e.target.checked)} />Get paid privately to my private address{asset.assetId !== null ? ` (${NATIVE} only)` : !targets.shielded ? " (create a private account first)" : ""}</label>
        <button className="primary" onClick={create} disabled={!amount.trim()}>Create request</button>
        {err && <div className="status err" role="alert">{err}</div>}
        {created && <><RequestShare r={created} /><button className="text-button" onClick={onShowRequests}>See all my requests →</button></>}
      </div>
      {asset.assetId === null && !pa.owner ? <PrivateAccountCard /> : <HowRequestsWork />}
    </div>
  );
}

function HowRequestsWork() {
  return (
    <div className="card">
      <h2>How requests work</h2>
      <ol className="steps plain">
        <li><span className="dot">1</span>You share a link. It holds the amount, your note and where to pay. Nothing is published.</li>
        <li><span className="dot">2</span>Your friend opens it and pays privately (encrypted note) or publicly.</li>
        <li><span className="dot">3</span>Private payments carry the request id inside the encrypted note, so your app marks the request paid when it scans. Public payments return a receipt you can verify on chain.</li>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- split a bill

function SplitForm({ wallet, onShowRequests }: { wallet: Wallet; onShowRequests: () => void }) {
  const targets = useReceiveTargets(wallet);
  const { contacts } = useContacts();
  const { add } = useMyRequests();
  const [name] = useMyName();
  const [asset, setAsset] = useState<RequestAsset>(TPOT);
  const [total, setTotal] = useState("");
  const [memo, setMemo] = useState("");
  const [people, setPeople] = useState<string[]>(["", ""]);
  const [includeMe, setIncludeMe] = useState(true);
  const [made, setMade] = useState<StoredRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const named = people.map((p) => p.trim()).filter(Boolean);
  const shares = useMemo(() => {
    try { return named.length ? splitAmount(total.trim(), asset.assetId === null ? NATIVE_PLANCK_DECIMALS : asset.decimals, named.length + (includeMe ? 1 : 0)) : []; } catch { return []; }
  }, [total, named.length, includeMe, asset]);

  function create() {
    setErr(null);
    try {
      if (!named.length) throw new Error("Add at least one person.");
      if (!shares.length) throw new Error("Enter the total.");
      const usePrivate = asset.assetId === null && !!targets.shielded;
      if (!usePrivate && !targets.account) throw new Error("Your public account is still loading.");
      const group = newRequestId();
      // with "include me", the first share (which absorbs rounding) is mine
      const theirs = includeMe ? shares.slice(1) : shares;
      const items: StoredRequest[] = named.map((who, i) => ({
        who,
        group,
        status: "open",
        request: createRequest({
          chainId: Number(DEPLOYMENT.chainId),
          asset,
          amount: theirs[i],
          to: { ...(usePrivate ? { shielded: targets.shielded! } : {}), ...(targets.account ? { account: targets.account } : {}) },
          name: name.trim() || undefined,
          memo: memo.trim() ? `${memo.trim()} (split)` : "Split bill",
        }),
      }));
      add(items);
      logActivity({ kind: "request", title: `Split ${total} ${asset.symbol} between ${named.length + (includeMe ? 1 : 0)}`, detail: memo || undefined, private: usePrivate });
      setMade(items);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const copyAll = () => navigator.clipboard.writeText(made!.map((m) => `${m.who}: ${requestLink(appUrl(), m.request)}`).join("\n"));

  return (
    <div className="grid">
      <div className="card">
        <h2>Split a bill</h2>
        <p className="hint">Each person gets their own link for their share. Shares add up exactly to the total.</p>
        <div className="two-col">
          <div><label htmlFor="sp-total">Total</label><input id="sp-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.0" /></div>
          <div><label htmlFor="sp-asset">Asset</label><select id="sp-asset" value={asset.symbol} onChange={(e) => setAsset(ASSETS.find((a) => a.symbol === e.target.value)!)}>{ASSETS.map((a) => <option key={a.symbol}>{a.symbol}</option>)}</select></div>
        </div>
        <label htmlFor="sp-memo">What for</label>
        <input id="sp-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Team dinner" maxLength={50} />
        <label>People</label>
        {contacts.length > 0 && <div className="denoms contact-chips">{contacts.map((c) => <button key={c.id} className={`chip ${named.includes(c.name) ? "active" : ""}`} onClick={() => setPeople((p) => named.includes(c.name) ? p.filter((x) => x.trim() !== c.name) : [...p.filter((x) => x.trim()), c.name])}>{c.name}</button>)}</div>}
        {people.map((p, i) => (
          <div className="row" key={i} style={{ marginTop: 6 }}>
            <input aria-label={`Person ${i + 1}`} value={p} onChange={(e) => setPeople(people.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Person ${i + 1}`} maxLength={40} />
            <span className="share-amount">{shares.length && p.trim() ? `${(includeMe ? shares.slice(1) : shares)[named.indexOf(p.trim())] ?? "…"} ${asset.symbol}` : ""}</span>
            {people.length > 1 && <button className="text-button" aria-label={`Remove person ${i + 1}`} onClick={() => setPeople(people.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => setPeople([...people, ""])} disabled={people.length >= 20}>Add person</button>
          <label className="row check-row" style={{ margin: 0 }}><input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} />Include my share{includeMe && shares.length ? ` (${shares[0]} ${asset.symbol})` : ""}</label>
        </div>
        <button className="primary" style={{ marginTop: 14 }} onClick={create} disabled={!named.length || !total.trim()}>Create {named.length || ""} request{named.length === 1 ? "" : "s"}</button>
        {err && <div className="status err" role="alert">{err}</div>}
      </div>
      <div className="card">
        <h2>Links</h2>
        {!made ? <p className="hint">Each person's link appears here after you create the split.</p> : <>
          <ul className="list">{made.map((m) => <li key={m.request.id}><span className="avatar">{m.who!.slice(0, 1).toUpperCase()}</span><span className="grow"><strong>{m.who}</strong><small> · {m.request.amount} {m.request.asset.symbol}</small></span><button className="text-button" onClick={() => navigator.clipboard.writeText(requestLink(appUrl(), m.request))}>Copy link</button></li>)}</ul>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={copyAll}>Copy all as a message</button><button onClick={onShowRequests}>Track payments →</button></div>
        </>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- my requests

function RequestsList({ receiptParam, onClearLink }: { receiptParam: string | null; onClearLink: () => void }) {
  const pa = usePrivateAccount();
  const { requests, remove } = useMyRequests();
  const [receiptInput, setReceiptInput] = useState(receiptParam ? `${appUrl()}?receipt=${receiptParam}` : "");
  const [status, setStatus] = useState<Status>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function checkReceipt(input: string) {
    setStatus({ t: "info", m: "Checking the payment on chain…" });
    try {
      const code = input.includes("receipt=") ? new URL(input.trim()).searchParams.get("receipt")! : input.trim();
      const receipt = decodeReceipt(code);
      const mine = findMyRequest(receipt.id);
      if (!mine) throw new Error("This receipt is for a request that was created in another browser.");
      const ok = await verifyReceipt(await getApi(), mine.request, receipt);
      if (!ok) throw new Error("The receipt's block does not contain a payment for this request.");
      markRequestPaid(receipt.id, "public", ok.payer);
      logActivity({ kind: "receive", title: `${mine.who ?? "A friend"} paid ${mine.request.amount} ${mine.request.asset.symbol}`, detail: mine.request.memo });
      setStatus({ t: "ok", m: `Verified on chain: ${short(ok.payer)} paid ${mine.request.amount} ${mine.request.asset.symbol}.` });
      setReceiptInput("");
      onClearLink();
    } catch (e: any) {
      setStatus({ t: "err", m: e.message });
    }
  }

  useEffect(() => { if (receiptParam) checkReceipt(receiptInput); }, [receiptParam]);

  const groups = new Map<string, StoredRequest[]>();
  for (const r of requests) groups.set(r.group ?? r.request.id, [...(groups.get(r.group ?? r.request.id) ?? []), r]);

  return (
    <div className="grid">
      <div className="card">
        <div className="card-title-row"><h2>My requests</h2>{pa.owner && <button className="text-button" onClick={() => pa.refresh()} disabled={pa.scanning}>{pa.scanning ? "Scanning…" : "Check private payments"}</button>}</div>
        {requests.length === 0 ? <p className="hint">Requests you create appear here with their status.</p> : (
          [...groups.values()].map((g) => (
            <div key={g[0].group ?? g[0].request.id} className="request-group">
              {g.length > 1 && <span className="toolbar-label">{g[0].request.memo?.replace(/ \(split\)$/, "")} · {g.filter((x) => x.status === "paid").length}/{g.length} PAID</span>}
              <ul className="list">
                {g.map((r) => (
                  <li key={r.request.id} className="request-row">
                    <span className={`tag ${r.status === "paid" ? "paid" : ""}`}>{r.status === "paid" ? (r.paidVia === "manual" ? "marked paid" : `paid ${r.paidVia}`) : "open"}</span>
                    <span className="grow"><strong>{r.request.amount} {r.request.asset.symbol}</strong><small> {r.who ? `from ${r.who}` : ""}{r.request.memo ? ` · ${r.request.memo}` : ""}</small></span>
                    {r.status === "open" && <button className="text-button" onClick={() => setOpen(open === r.request.id ? null : r.request.id)}>{open === r.request.id ? "Hide" : "Share"}</button>}
                    {r.status === "open" && <button className="text-button" onClick={() => markRequestPaid(r.request.id, "manual")}>Mark paid</button>}
                    <button className="text-button" aria-label="Delete request" onClick={() => remove(r.request.id)}>×</button>
                    {open === r.request.id && <div className="full"><RequestShare r={r.request} /></div>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      <div className="card">
        <h2>Verify a public payment</h2>
        <p className="hint">When a friend pays publicly, their app gives them a receipt link to send you. It is checked against the chain: the payment and your request id must be in the same transaction.</p>
        <label htmlFor="receipt">Receipt link</label>
        <textarea id="receipt" className="short" value={receiptInput} onChange={(e) => setReceiptInput(e.target.value)} placeholder="…?receipt=…" spellCheck={false} />
        <button className="primary" onClick={() => checkReceipt(receiptInput)} disabled={!receiptInput.trim()}>Verify</button>
        <StatusLine s={status} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- paying someone's request

function PayRequestView({ encoded, wallet, onConnect, onDone }: { encoded: string; wallet: Wallet | null; onConnect: () => void; onDone: () => void }) {
  const pa = usePrivateAccount();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  let req: PaymentRequest | null = null;
  let error: string | null = null;
  try {
    req = decodeRequest(encoded);
    if (req.chainId !== Number(DEPLOYMENT.chainId)) error = `This request is for chain ${req.chainId}, but the app is on ${DEPLOYMENT.network}.`;
  } catch (e: any) {
    error = e.message;
  }
  const mine = req ? findMyRequest(req.id) : undefined;
  const units = req ? toUnits(req.amount, 18) : 0n;
  const fromPrivate = !!req?.to.shielded && !!pa.owner && pa.spendable >= units;

  async function pay(kind: "private" | "wallet" | "public") {
    if (!req || !wallet) return;
    setBusy(true);
    setStatus(null);
    try {
      const info = (m: string) => setStatus({ t: "info", m });
      let ref: TxRef & { blockHash?: string };
      if (kind === "public") {
        ref = await payPublicly(wallet, { asset: req.asset, to: req.to.account!, amount: req.amount, requestId: req.id }, info);
        if (ref.blockHash) setReceipt(`${appUrl()}?receipt=${encodeReceipt({ v: 1, id: req.id, chainId: req.chainId, blockHash: ref.blockHash })}`);
      } else {
        ref = await payPrivately(wallet, pa.client, { source: kind, owner: pa.owner, to: req.to.shielded!, amount: req.amount, memo: requestMemo(req.id, req.memo ?? "") }, info);
        pa.refresh();
      }
      logActivity({ kind: "pay", title: `Paid ${req.amount} ${req.asset.symbol} to ${req.name ?? "a request"}`, detail: req.memo, href: ref.href, private: kind !== "public" });
      setPaid(true);
      setStatus({ t: "ok", m: kind === "public" ? `Paid · ${ref.label}` : `Paid privately · ${ref.label}. Their app will match this payment automatically.`, href: ref.href });
    } catch (e: any) {
      setStatus({ t: "err", m: e?.shortMessage || e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card pay-card">
        <span className="toolbar-label">PAYMENT REQUEST</span>
        {error || !req ? <div className="status err" role="alert">{error}</div> : <>
          <h2 className="pay-amount">{req.amount} <small>{req.asset.symbol}</small></h2>
          <p><strong>{req.name ?? "Someone"}</strong> is asking you to pay{req.memo ? <> for <em>{req.memo}</em></> : null}.</p>
          {mine && <div className="status info">This is your own request ({mine.status}).</div>}
          {!wallet ? <button className="primary" onClick={onConnect}>Connect Portaldot to pay</button> : paid ? null : <>
            {req.to.shielded && <>
              <span className="toolbar-label" style={{ marginTop: 16 }}>PAY PRIVATELY</span>
              <div className="pay-options">
                <button className="primary" disabled={busy || !fromPrivate} onClick={() => pay("private")}>From my private balance{pa.owner ? ` (${fmt(pa.spendable, 18, 4)} ${NATIVE})` : ""}</button>
                <button disabled={busy} onClick={() => pay("wallet")}>From my wallet</button>
              </div>
              <p className="privacy-note private">{fromPrivate ? "From your private balance, nobody can see who paid whom or how much." : "From your wallet, the recipient stays hidden but your wallet and the amount are visible as a deposit."}</p>
            </>}
            {req.to.account && <>
              <span className="toolbar-label" style={{ marginTop: 16 }}>PAY PUBLICLY</span>
              <div className="pay-options"><button disabled={busy} onClick={() => pay("public")}>Pay {short(req.to.account)}</button></div>
              {wallet.kind === "evm" && <p className="hint">From an EVM wallet the payment cannot carry the request id, so no receipt is generated.</p>}
            </>}
          </>}
          <StatusLine s={status} />
          {receipt && <div className="share-box"><div><strong>Send this receipt back</strong><p className="hint">It lets {req.name ?? "them"} verify your payment on chain.</p><p className="mono wrap">{short(receipt)}</p><div className="row"><button className="primary" onClick={() => navigator.clipboard.writeText(receipt)}>Copy receipt link</button>{"share" in navigator && <button onClick={() => navigator.share({ title: "Payment receipt", url: receipt }).catch(() => {})}>Share…</button>}</div></div></div>}
          {(paid || mine) && <button className="text-button" style={{ marginTop: 12 }} onClick={onDone}>Back to Umbra →</button>}
        </>}
      </div>
      {wallet && req?.to.shielded ? <PrivateAccountCard compact /> : <HowRequestsWork />}
    </div>
  );
}
