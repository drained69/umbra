import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { Keypair, Utxo, type MultiAssetPlan } from "@umbra/sdk";
import { DEPLOYMENT } from "../lib/chain";
import { MA, maClient, proveMulti, spendMulti, submitMultiWithWallet, useMaRelayer } from "../lib/multi";
import { usePrivateAccount } from "../lib/privateAccount";
import { checkoutApi, checkoutUrl, downloadBlob, downloadOrder, merchants, saveMerchant, type CheckoutOrder, type CheckoutProduct, type Merchant } from "../lib/checkout";
import { fmt } from "../lib/finance";
import type { Wallet } from "../lib/wallet";
import PrivateAccountCard from "./PrivateAccountCard";
import CopyButton from "./CopyButton";
import QrCode from "./QrCode";

const SAMPLE = "UMBRA FIELD NOTES\n\nA practical guide to private payments\n\n1. Back up your private account before receiving funds.\n2. Check the recipient, asset, total and relayer fee before paying.\n3. Use a private balance when you want to avoid exposing a public wallet as the payer.\n4. Privacy depends on the pool's activity and how you use your addresses.\n5. Keep your order link private: it grants access to your purchase.\n\nThank you for trying Umbra Checkout on Portaldot.\n";
const message = (e: any) => e?.shortMessage || e?.message || "Something went wrong. Please retry.";

export default function CheckoutPanel({ wallet, productId, onConnect }: { wallet: Wallet | null; productId?: string | null; onConnect: () => void }) {
  return productId ? <Storefront key={productId} id={productId} wallet={wallet} onConnect={onConnect} /> : <MerchantDashboard />;
}

function MerchantDashboard() {
  const pa = usePrivateAccount();
  const [items, setItems] = useState(merchants);
  const [selected, setSelected] = useState<Merchant | null>(() => merchants()[0] ?? null);
  const [orders, setOrders] = useState<CheckoutOrder[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("1");
  const [to, setTo] = useState("");
  const [delivery, setDelivery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSeq = useRef(0);
  const creating = useRef(false);
  async function refresh(m: Merchant | null = selected) {
    const seq = ++requestSeq.current;
    if (!m) return;
    setBusy(true); setError("");
    try { const rows = await checkoutApi<CheckoutOrder[]>(`/products/${m.product.id}/orders`, undefined, m.token); if (seq === requestSeq.current) setOrders(rows); }
    catch (e) { if (seq === requestSeq.current) setError(message(e)); }
    finally { if (seq === requestSeq.current) setBusy(false); }
  }
  useEffect(() => { setOrders([]); void refresh(selected); }, [selected?.product.id]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (creating.current) return; creating.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const m = await checkoutApi<Merchant>("/products", { name, description, amount, to, delivery });
      saveMerchant(m); setItems(prev => [...prev.filter(x => x.product.id !== m.product.id), m]); setSelected(m);
      setNotice("Checkout created. Download your merchant backup before leaving this browser.");
    } catch (e) { setError(message(e)); } finally { creating.current = false; setBusy(false); }
  }
  async function restore(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError("");
    try {
      if (file.size > 20000) throw Error("Invalid merchant backup.");
      const m = JSON.parse(await file.text()) as Merchant;
      if (!/^[a-f0-9]{64}$/.test(m?.product?.id) || !/^[a-f0-9]{64}$/.test(m?.token)) throw Error("Invalid merchant backup.");
      await checkoutApi(`/products/${m.product.id}/orders`, undefined, m.token);
      m.product = await checkoutApi(`/products/${m.product.id}`);
      saveMerchant(m); setItems(prev => [...prev.filter(x => x.product.id !== m.product.id), m]); setSelected(m);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const link = selected ? checkoutUrl(selected.product.id) : "";
  return <>
    <div className="checkout-intro"><span className="toolbar-label">UMBRA CHECKOUT</span><h2>Your shop. Private payments.</h2><p>Sell a digital download for pUSD. Share one link, receive funds in your private account, and track verified orders.</p></div>
    <div className="grid checkout-grid">
      <form className="card" onSubmit={create}>
        <div className="card-title-row"><h2>Create a checkout</h2><button type="button" className="text-button" onClick={() => { setName("Umbra Field Notes"); setDescription("A short guide to private payments. A sample digital product powered by Umbra Checkout."); setDelivery(SAMPLE); setAmount("1"); if (pa.owner) setTo(pa.owner.address()); }}>Use sample product</button></div>
        <label htmlFor="shop-name">Product name</label><input id="shop-name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Your digital product" />
        <label htmlFor="shop-description">Short description</label><textarea id="shop-description" maxLength={280} value={description} onChange={e => setDescription(e.target.value)} />
        <label htmlFor="shop-price">Price in pUSD</label><input id="shop-price" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" value={amount} onChange={e => setAmount(e.target.value)} />
        <label htmlFor="shop-to">Your private receiving address</label><textarea id="shop-to" required className="short mono" value={to} onChange={e => setTo(e.target.value)} placeholder="umbra-addr-…" />
        {pa.owner && <button type="button" className="text-button" onClick={() => setTo(pa.owner!.address())}>Use my private account</button>}
        <label htmlFor="shop-delivery">Text download delivered after payment</label><textarea id="shop-delivery" required maxLength={6000} value={delivery} onChange={e => setDelivery(e.target.value)} placeholder="Your guide, template, or digital product (up to 6,000 characters)" />
        <p className="hint">The checkout server stores this content and releases a .txt download after a finalized payment. Your private spending key stays with you.</p>
        <button className="primary" disabled={busy || !MA}>Create checkout link</button>
      </form>
      <div className="checkout-column">
        <section className="card">
          <h2>My storefronts</h2>
          {items.length ? <><label htmlFor="shop-select">Select a product</label><select id="shop-select" value={selected?.product.id ?? ""} onChange={e => setSelected(items.find(m => m.product.id === e.target.value)!)}>{items.map(m => <option key={m.product.id} value={m.product.id}>{m.product.name}</option>)}</select></> : <p className="hint">Your products and orders will appear here.</p>}
          {selected && <>
            <p className="checkout-price">{selected.product.amount} <small>pUSD</small></p>
            <div className="row"><CopyButton value={link}>Copy checkout link</CopyButton><a className="button" href={link} target="_blank" rel="noreferrer">Open storefront ↗</a></div>
            <details className="checkout-details"><summary>QR code & website button</summary><QrCode value={link} label="Scan to open this storefront" /><CopyButton value={`<a href="${link}" target="_blank" rel="noopener noreferrer">Pay privately with Umbra</a>`}>Copy embed HTML</CopyButton><p className="hint">Paste the link button into your website. It opens a hosted checkout.</p></details>
            <button className="text-button" onClick={() => downloadBlob(new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" }), "umbra-merchant-backup.json")}>Download merchant backup</button>
            <p className="hint">Keep this backup private. It contains the access key for your order dashboard; it cannot spend your funds.</p>
          </>}
          <label htmlFor="shop-restore">Restore merchant backup</label><input id="shop-restore" type="file" disabled={busy} accept="application/json,.json" onChange={e => void restore(e.target.files?.[0])} />
        </section>
        <section className="card"><div className="card-title-row"><h2>Orders</h2><button disabled={busy || !selected} className="text-button" onClick={() => void refresh()}>Refresh</button></div>
          <div className="checkout-stats"><div><strong>{orders.filter(o => o.status === "paid").length}</strong><span>Verified payments</span></div><div><strong>{orders.filter(o => o.status !== "paid").length}</strong><span>Awaiting payment</span></div></div>
          {!orders.length ? <p className="hint">No orders yet. Share your storefront to receive your first payment.</p> : <ul className="list checkout-orders">{[...orders].reverse().map(o => <li key={o.id}><span className="grow"><strong>Order {o.id.slice(0, 8)}</strong><small>{new Date(o.created).toLocaleString()}</small></span><span className={`tag ${o.status === "paid" ? "paid" : ""}`}>{o.status === "paid" ? "Verified paid" : "Awaiting"}</span></li>)}</ul>}
        </section>
      </div>
    </div>
    {error && <div className="status err" role="alert">{error}</div>}{notice && <div className="status ok" role="status">{notice}</div>}
    {!pa.owner && <PrivateAccountCard compact />}
  </>;
}

function Storefront({ id, wallet, onConnect }: { id: string; wallet: Wallet | null; onConnect: () => void }) {
  const pa = usePrivateAccount();
  const relay = useMaRelayer();
  const [product, setProduct] = useState<CheckoutProduct | null>(null);
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [verifyError, setVerifyError] = useState("");
  const paymentLock = useRef(false);
  function acceptOrder(next: CheckoutOrder) {
    if (next.productId !== id) throw Error("This order belongs to another storefront.");
    setOrder(previous => previous?.id === next.id && previous.status === "paid" ? previous : next);
    setVerifyError("");
    if (next.status === "paid") setError("");
  }
  useEffect(() => {
    let stop = false;
    setError(""); setLoaded(false);
    (async () => {
      const p = await checkoutApi<CheckoutProduct>(`/products/${id}`);
      if (p.chainId !== Number(DEPLOYMENT.chainId) || p.pool.toLowerCase() !== MA?.address.toLowerCase() || !MA.assets.some(a => a.id === p.asset.id && a.symbol === "pUSD" && a.decimals === p.asset.decimals)) throw Error("This checkout uses a different network or pool.");
      if (!/^umbra-addr-[a-f0-9]{64}-[a-f0-9]{64}$/i.test(p.to) || ethers.parseUnits(p.amount, p.asset.decimals) <= 0n) throw Error("Invalid checkout product.");
      if (!stop) setProduct(p);
      const orderId = new URLSearchParams(location.search).get("order");
      if (orderId) {
        const o = await checkoutApi<CheckoutOrder>(`/orders/${orderId}`);
        if (o.productId !== id) throw Error("This order belongs to another storefront.");
        if (!stop) { setOrder(o); setAttempted(true); }
      }
      if (!stop) setLoaded(true);
    })().catch(e => { if (!stop) setError(message(e)); });
    return () => { stop = true; };
  }, [id, loadVersion]);
  useEffect(() => {
    if (!order || order.status === "paid") return;
    let stop = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const o = await checkoutApi<CheckoutOrder>(`/orders/${order.id}/verify`, {}); if (!stop) acceptOrder(o); }
      catch (e) { if (!stop) setVerifyError(message(e)); }
      finally { if (!stop) timer = setTimeout(poll, 20000); }
    };
    timer = setTimeout(poll, 1000);
    return () => { stop = true; clearTimeout(timer); };
  }, [order?.id, order?.status]);
  const amount = product ? ethers.parseUnits(product.amount, product.asset.decimals) : 0n;
  const asset = BigInt(product?.asset.id ?? 1);
  const fee = relay.state === "ready" ? (relay.quote.fees[Number(asset)] ?? null) : null;
  const canPrivate = !!pa.owner && !pa.scanning && !pa.error && fee !== null && pa.maSpendable(asset) >= amount + fee;
  async function pay(source: "private" | "wallet") {
    if (paymentLock.current || !loaded || attempted || !product || !maClient || (source === "private" && !canPrivate)) return;
    paymentLock.current = true;
    setBusy(true); setError("");
    try {
      let o = order;
      if (!o) {
        o = await checkoutApi<CheckoutOrder>(`/products/${id}/orders`, {});
        setOrder(o); const url = new URL(location.href); url.searchParams.set("order", o.id); history.replaceState(null, "", url);
      }
      const existing = await checkoutApi<CheckoutOrder>(`/orders/${o.id}/verify`, {});
      if (existing.status === "paid") { acceptOrder(existing); return; }
      const note = new Utxo({ keypair: Keypair.fromAddress(product.to), asset, amount, blinding: BigInt(o.blinding), memo: `checkout:${o.id}` });
      if (note.commitment().toString() !== o.commitment) throw Error("Checkout payment commitment does not match this order.");
      const ciphertext = ethers.getBytes(o.encryptedOutput);
      note.encryptTo = () => ciphertext;
      const bind = (plan: MultiAssetPlan) => { plan.outputs[0] = note; return plan; };
      setAttempted(true);
      if (source === "private") {
        await spendMulti(asset, async relay => bind(await maClient!.planPayment({ owner: pa.owner!, to: product.to, asset, amount, relay })), setStatus);
      } else {
        if (!wallet) throw Error("Connect a wallet to pay.");
        setStatus("Generating the payment proof in your browser…");
        await submitMultiWithWallet(wallet, await proveMulti(bind(maClient.planDeposit(pa.owner ?? new Keypair(), asset, amount, product.to))), setStatus);
      }
      setSubmitted(true); setStatus("Payment submitted. Waiting for finalized verification…");
      acceptOrder(await checkoutApi(`/orders/${o.id}/verify`, {})); void pa.refresh();
    } catch (e) { setError(message(e)); }
    finally { paymentLock.current = false; setBusy(false); }
  }
  async function verify() { if (!order) return; setBusy(true); setError(""); try { acceptOrder(await checkoutApi(`/orders/${order.id}/verify`, {})); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  return <div className="grid checkout-grid">
    <section className="card checkout-storefront">
      <span className="toolbar-label">PRIVATE CHECKOUT · DIGITAL DOWNLOAD</span>
      {!product ? <p role="status">{error ? "Storefront unavailable" : "Loading storefront…"}</p> : <>
        <div className="checkout-cover" aria-hidden="true">U<span>DIGITAL EDITION</span></div>
        <h2>{product.name}</h2><p>{product.description}</p>
        <div className="checkout-price">{product.amount} <small>pUSD</small></div>
        <p className="hint">A text download, delivered after on-chain verification.</p>
        <div className={`checkout-order-state ${order?.status === "paid" ? "paid" : ""}`} role="status">{order?.status === "paid" ? "✓ Payment verified · Your download is ready" : submitted ? "Confirming payment" : "Awaiting payment"}</div>
        {order && <p className="hint mono">Order {order.id.slice(0, 8)}</p>}
        {order?.status === "paid" ? <button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await downloadOrder(order.id); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>Download your purchase ↓</button> : <>
          <p className="hint">Private balance: {pa.scanning ? "Checking…" : pa.error ? "Unavailable — refresh your private account" : `${fmt(pa.maBalances.get(asset) ?? 0n, product.asset.decimals, 6)} pUSD`}</p>
          <p className="hint">{fee !== null ? `Private payment total: ${ethers.formatUnits(amount + fee, product.asset.decimals)} pUSD (includes ${ethers.formatUnits(fee, product.asset.decimals)} pUSD relayer fee).` : relay.state === "down" ? "Relayer unavailable. Wallet payments remain available." : "Checking relayer fee…"} Wallet payments require network fees in tPOT.</p>
          <div className="checkout-pay-buttons"><button className="primary" disabled={!loaded || busy || !canPrivate || attempted} onClick={() => void pay("private")}>Pay from private balance</button>
          {wallet ? <button disabled={!loaded || busy || attempted} onClick={() => void pay("wallet")}>Pay from wallet</button> : <button onClick={onConnect} disabled={busy}>Connect wallet</button>}</div>
          {order && <button className="text-button" disabled={busy} onClick={() => void verify()}>Check payment status</button>}
          {attempted && !submitted && !busy && <div className="notice-card"><p>A payment may already be in progress. Check its status before retrying.</p><button onClick={() => { setAttempted(false); setError(""); }}>I confirmed no payment was sent — retry</button></div>}
        </>}
        {order && <div className="row"><CopyButton value={location.href}>Copy order recovery link</CopyButton></div>}
        <p className="hint">Keep your order link private: anyone with it can access the purchased download. The merchant and checkout operator see the product, price and payment note. Paying from a public wallet also exposes that wallet and the deposit amount.</p>
        {status && order?.status !== "paid" && <div className="status info" role="status">{status}</div>}
      </>}
      {error && <div className="status err" role="alert">{error}</div>}
      {verifyError && <div className="status err" role="alert">{verifyError} Your order is saved; verification will retry automatically.</div>}
      {!loaded && error && <button onClick={() => setLoadVersion(v => v + 1)}>Retry loading checkout</button>}
    </section>
    <div className="checkout-column"><PrivateAccountCard compact /><div className="card"><h2>How delivery works</h2><ol className="checkout-steps"><li>Pay the exact price into the merchant’s private account.</li><li>Umbra checks the payment against finalized pool events.</li><li>Download your purchase or return using your order link.</li></ol><p className="hint">Payments use Portaldot testnet pUSD. The checkout operator hosts the product and verifies delivery eligibility.</p></div></div>
  </div>;
}
