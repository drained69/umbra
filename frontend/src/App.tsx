import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ethers } from "ethers";
import { UmbraPoolClient, UmbraNative, exportViewingKey, type Note } from "@umbra/sdk";
import { DEPLOYMENT, NATIVE, HAS_EVM_RPC, assets, isCrossVmPool, format, getApi, readProvider, short, blockLink, PORTALDOT_EXTENSION_URL } from "./lib/chain";
import { connectEvm, connectNative, getViewingKey, listNativeAccounts, restoreViewingKey, type NativeAccount, type Wallet } from "./lib/wallet";
import type { TxRef } from "./components/DepositPanel";
import CopyButton from "./components/CopyButton";
import { ArrowRightIcon, EyeOffIcon, HomeIcon, KeyIcon, LockIcon, PrivacyIcon, RequestIcon, SendIcon, ShieldIcon, SwapIcon, WalletIcon } from "./components/Icons";
import { PrivateAccountProvider } from "./lib/privateAccount";
import type { PaySub } from "./components/PayPanel";

const WalletPanel = lazy(() => import("./components/WalletPanel"));
const PayPanel = lazy(() => import("./components/PayPanel"));
const SwapPanel = lazy(() => import("./components/SwapPanel"));
const DepositPanel = lazy(() => import("./components/DepositPanel"));
const WithdrawPanel = lazy(() => import("./components/WithdrawPanel"));
const AuditorPanel = lazy(() => import("./components/AuditorPanel"));
const PrivateTransferPanel = lazy(() => import("./components/PrivateTransferPanel"));
// Operator-only deployment tools, reachable at ?admin (cross-VM) or ?admin=full; not linked in the app.
const DeployPanel = lazy(() => import("./components/DeployPanel"));
const CrossVmDeployPanel = lazy(() => import("./components/CrossVmDeployPanel"));

type Tab = "overview" | "wallet" | "pay" | "swap" | "deposit" | "withdraw" | "transfer" | "auditor";
/** Tabs that act on one fixed-size pool and show the asset / pool-size toolbar. */
const POOL_TABS: Tab[] = ["deposit", "withdraw", "auditor"];
const LINK = new URLSearchParams(location.search);
const ADMIN = LINK.has("admin");
const REPO_URL: string = (import.meta as any).env?.VITE_REPO_URL || "";
const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL || "";
const NET_LABEL = DEPLOYMENT.network === "portaldot-v3-live" ? "Portaldot V3 live" : "Portaldot V3 testnet";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAccount[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("");
  // `?pay=` opens a friend's payment request; `?receipt=` verifies a public payment to you.
  const [payParam, setPayParam] = useState<string | null>(() => LINK.get("pay"));
  const [receiptParam, setReceiptParam] = useState<string | null>(() => LINK.get("receipt"));
  const [tab, setTab] = useState<Tab>(() => (LINK.has("pay") || LINK.has("receipt") ? "pay" : "overview"));
  const [paySub, setPaySub] = useState<PaySub>(() => (LINK.has("receipt") ? "requests" : "send"));
  const clearLink = () => {
    setPayParam(null);
    setReceiptParam(null);
    const url = new URL(location.href);
    url.searchParams.delete("pay");
    url.searchParams.delete("receipt");
    history.replaceState(null, "", url);
  };
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);
  const accountPickerRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: MouseEvent) => { if (!accountMenuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  useEffect(() => {
    if (!nativeAccounts) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    accountPickerRef.current?.querySelector("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setNativeAccounts(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); previousFocus?.focus(); };
  }, [nativeAccounts]);

  function keepFocusInPicker(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const buttons = accountPickerRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if (!buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const contracts = DEPLOYMENT.contracts;

  const assetList = useMemo(() => assets(), []);
  const configuredAssets = assetList.filter((item) => Object.values(item.pools).some((address) => ethers.isAddress(address) && address !== ethers.ZeroAddress));
  const configuredPoolCount = assetList.reduce((total, item) => total + Object.values(item.pools).filter((address) => ethers.isAddress(address) && address !== ethers.ZeroAddress).length, 0);
  const privateAccountReady = ethers.isAddress(contracts.shieldedPool) && contracts.shieldedPool !== ethers.ZeroAddress;
  const assetNames = configuredAssets.map((item) => item.symbol).join(" or ");
  const [assetSym, setAssetSym] = useState(assetList[0]?.symbol ?? "tPOT");
  const asset = assetList.find((a) => a.symbol === assetSym);
  const denoms = asset ? Object.keys(asset.pools) : [];
  // Default to an EVM-verified pool: withdrawing from a WASM-verified one needs its attestor.
  const defaultDenom = (pools: Record<string, string>) => Object.keys(pools).find((d) => !isCrossVmPool(pools[d])) ?? Object.keys(pools)[0] ?? "";
  const [denom, setDenom] = useState<string>(() => defaultDenom(asset?.pools ?? {}));
  useEffect(() => setDenom(defaultDenom(asset?.pools ?? {})), [assetSym]);
  const poolAddr = asset?.pools[denom];
  const configured = !!poolAddr && poolAddr !== ethers.ZeroAddress;

  const client = useMemo(() => {
    if (!configured || !asset) return null;
    const runner = wallet?.kind === "evm" ? wallet.signer : readProvider;
    return new UmbraPoolClient(poolAddr!, runner, { deployBlock: DEPLOYMENT.deployBlock ?? 0, assetRules: asset.rules });
  }, [wallet, poolAddr, configured, asset]);

  // balances
  useEffect(() => {
    if (!wallet) { setBalance(""); return; }
    let stop = false;
    (async () => {
      if (wallet.kind === "native") {
        const api = await getApi();
        const acc: any = await api.query.system.account(wallet.account);
        if (!stop) setBalance(format(acc.data.free.toBigInt() * 10n ** 4n, 18));
      } else {
        const b = await readProvider.getBalance(wallet.address);
        if (!stop) setBalance(format(b, 18));
      }
    })().catch(() => { if (!stop) setBalance(""); });
    return () => {
      stop = true;
    };
  }, [wallet]);

  async function pickNative() {
    if (connecting) return;
    setConnecting(true);
    setConnectErr(null);
    try {
      const { extensions, accounts } = await listNativeAccounts();
      if (!extensions.length) throw new Error("No Portaldot Extension found.");
      if (!accounts.length) throw new Error("The extension has no accounts (or access was denied).");
      if (accounts.length === 1) await chooseNative(accounts[0]);
      else setNativeAccounts(accounts);
    } catch (e: any) {
      setConnectErr(e.message);
    } finally { setConnecting(false); }
  }
  async function chooseNative(a: NativeAccount) {
    try {
      const w = await connectNative(a);
      setWallet(w);
      setNativeAccounts(null);
      setViewingKey(await getViewingKey(w));
      setConnectErr(null);
    } catch (e: any) { setConnectErr(e?.message || String(e)); }
  }
  async function pickEvm() {
    if (connecting) return;
    setConnecting(true);
    setConnectErr(null);
    try {
      setWallet(await connectEvm());
      setViewingKey(null);
    } catch (e: any) {
      setConnectErr(e.message);
    } finally { setConnecting(false); }
  }

  /** Deposit through whichever wallet is connected; returns refs to show the user. */
  async function deposit(note: Note, memo: Uint8Array): Promise<TxRef[]> {
    if (!client || !wallet) throw new Error("connect a wallet first");
    if (wallet.kind === "evm") {
      const hash = await client.deposit(note, memo);
      return [{ label: `EVM tx ${short(hash)}` }];
    }
    const api = await getApi();
    const res = await new UmbraNative(api, wallet.account, { signer: wallet.signer }).deposit(client, note, memo);
    return res.map((r, i) => ({
      label: `${res.length > 1 && i === 0 ? "approval" : "deposit"} in block ${short(r.blockHash)}`,
      href: blockLink(r.blockHash),
    }));
  }

  const navigation: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "overview", label: "Home", icon: <HomeIcon /> },
    { id: "wallet", label: "Wallet", icon: <WalletIcon /> },
    { id: "pay", label: "Pay", icon: <SendIcon /> },
    { id: "swap", label: "Swap", icon: <SwapIcon /> },
    { id: "transfer", label: "Privacy", icon: <PrivacyIcon /> },
  ];
  const privacyTools: { id: Tab; label: string }[] = [
    { id: "transfer", label: "Private account" },
    { id: "deposit", label: "Shield" },
    { id: "withdraw", label: "Withdraw" },
    { id: "auditor", label: "Viewing keys" },
  ];
  const isPrivacyTab = (t: Tab) => privacyTools.some((p) => p.id === t);
  const openTab = (next: Tab) => { setTab(next); window.scrollTo({ top: 0, behavior: "instant" }); };
  const goTo = (next: "pay" | "swap", sub?: PaySub) => { if (sub) setPaySub(sub); openTab(next); };
  const pageTitle = tab === "pay" && payParam ? "Pay a request" : isPrivacyTab(tab) ? privacyTools.find((p) => p.id === tab)!.label : navigation.find((n) => n.id === tab)?.label ?? "";
  const pageDescription =
    tab === "wallet" ? "Your balances, ways to get paid, and the people you pay."
    : tab === "pay" ? (payParam ? "Someone sent you a payment request." : "Pay anyone, request money, or split a bill.")
    : tab === "swap" ? "Trade tPOT and pUSD on Portaldot's built-in exchange."
    : tab === "transfer" ? "Hold a private balance and send it to other private addresses."
    : tab === "deposit" ? "Move a fixed amount into a shielded pool. You keep the note that unlocks it."
    : tab === "withdraw" ? "Withdraw a shielded note to any address without revealing which deposit it was."
    : "Share read-only access to your activity. A viewing key can never spend.";
  const connectPrompt = (what: string) => (
    <div className="wallet-prompt">
      <span className="prompt-icon"><WalletIcon /></span>
      <h2>Connect your wallet</h2>
      <p>{what} Every transaction is signed in your own wallet; Umbra never holds your keys or funds.</p>
      <div className="prompt-buttons">
        <button className="primary" onClick={pickNative} disabled={connecting}>{connecting ? "Connecting…" : "Connect Portaldot wallet"}</button>
        {HAS_EVM_RPC && <button className="ghost" onClick={pickEvm} disabled={connecting}>Use an EVM wallet</button>}
      </div>
    </div>
  );

  return (
    <PrivateAccountProvider>
    <div className="workspace">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <button className="brand-lockup" type="button" onClick={() => openTab("overview")} aria-label="Umbra home">
          <img className="brand-symbol" src="/umbra-mark.svg" alt="" width="32" height="32" /><strong>umbra<span className="brand-period">.</span></strong>
        </button>
        {!ADMIN && <nav className="app-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const active = tab === item.id || (item.id === "transfer" && isPrivacyTab(tab));
            return <button key={item.id} className={`nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => openTab(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>;
          })}
        </nav>}
        <div className="topbar-right">
          {wallet ? <div className="account-menu" ref={accountMenuRef}>
            <button className="account-tag" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} title={wallet.kind === "native" ? wallet.account : wallet.address}>
              <span className="account-avatar">{(wallet.kind === "native" ? wallet.label : "E").slice(0, 1).toUpperCase()}</span>
              <span>{wallet.kind === "native" ? wallet.label : short(wallet.address)}</span>
              {balance && <small>{Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {NATIVE}</small>}
              <span className="account-caret" aria-hidden="true">▾</span>
            </button>
            {menuOpen && <div className="account-dropdown" role="menu">
              <div className="account-dropdown-head"><strong>{wallet.kind === "native" ? wallet.label : "EVM wallet"}</strong><span className="mono">{short(wallet.kind === "native" ? wallet.account : wallet.address)}</span></div>
              <CopyButton value={wallet.kind === "native" ? wallet.account : wallet.address}>Copy address</CopyButton>
              <button role="menuitem" onClick={() => { setMenuOpen(false); (wallet.kind === "native" ? pickNative : pickEvm)(); }}>Switch account</button>
              <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setWallet(null); setViewingKey(null); setBalance(""); }}>Disconnect</button>
            </div>}
          </div> : <button className="topbar-connect" onClick={pickNative} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button>}
        </div>
      </header>

      <div className="workspace-main">
        <main className="workspace-scroll" id="main-content" tabIndex={-1}>
          <div className="network-notice" role="note"><span className="network-dot" />{NET_LABEL}<span className="network-notice-detail">{DEPLOYMENT.network === "portaldot-v3-live" ? "Live network: transactions use real POT" : "Test tokens only, no real monetary value"}</span></div>
          <div className="content-wrap">
            {ADMIN ? <>
              <div className="page-heading"><div><h1>Operator console</h1><p>Deployment tools for whoever operates this Umbra instance. Not linked from the app; deployed addresses are listed in the README.</p></div></div>
              {wallet?.kind === "native" ? <Suspense fallback={<div className="loading-panel" role="status">Loading deployment tools…</div>}>
                {new URLSearchParams(location.search).get("admin") === "full" ? <DeployPanel key={wallet.account} wallet={wallet} /> : <CrossVmDeployPanel key={wallet.account} wallet={wallet} />}
              </Suspense> : connectPrompt("Deployments are signed by a native Portaldot account.")}
            </> : tab === "overview" ? <>
              <section className="hero-panel" aria-labelledby="hero-title">
                <div className="hero-copy">
                  <span className="hero-eyebrow"><span className="status-orb" /> Private payments on Portaldot</span>
                  <h1 id="hero-title">Your money.<br /><em>Your privacy.</em></h1>
                  <p>Pay friends, request money, split bills and swap — publicly when it doesn't matter, privately when it does. You always see what is shared before you sign.</p>
                  <div className="hero-actions">
                    {wallet ? <button className="hero-primary" onClick={() => openTab("wallet")}>Open your wallet</button> : <button className="hero-primary" onClick={pickNative} disabled={connecting}>{connecting ? "Connecting…" : "Connect wallet"}</button>}
                    <button className="hero-secondary" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How it works</button>
                  </div>
                  <small className="hero-disclosure">Deposits, withdrawals and the wallet that pays the fee stay public. Umbra hides the link between them.</small>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <svg viewBox="0 0 320 320" fill="none">
                    <defs>
                      <linearGradient id="hero-light" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#e6f7ee" /><stop offset="1" stopColor="#8fd6b1" /></linearGradient>
                      <mask id="hero-crescent"><rect width="320" height="320" fill="#fff" /><circle cx="196" cy="124" r="78" fill="#000" /></mask>
                    </defs>
                    <circle cx="160" cy="160" r="138" stroke="#d9f2e4" strokeOpacity=".16" strokeDasharray="2 9" />
                    <circle cx="160" cy="160" r="112" stroke="#d9f2e4" strokeOpacity=".1" />
                    <circle cx="160" cy="160" r="90" fill="url(#hero-light)" mask="url(#hero-crescent)" />
                    <circle cx="160" cy="160" r="90" stroke="#d9f2e4" strokeOpacity=".3" strokeWidth="1.5" />
                    <circle cx="226" cy="226" r="9" fill="#8fd6b1" />
                    <circle cx="57" cy="94" r="4" fill="#d9f2e4" fillOpacity=".55" />
                  </svg>
                </div>
              </section>

              <div className="overview-facts">
                <div><span className="fact-icon"><KeyIcon /></span><div><strong>Your keys, your money</strong><span>Every payment is signed in your own wallet. Umbra never holds your funds.</span></div></div>
                <div><span className="fact-icon"><EyeOffIcon /></span><div><strong>Private by choice</strong><span>Pay a private address and the recipient and amount stay off the public record.</span></div></div>
                <div><span className="fact-icon"><ShieldIcon /></span><div><strong>Share on your terms</strong><span>Give an accountant read-only access with a viewing key. It can never spend.</span></div></div>
              </div>

              <div className="section-title"><h2>Everything you need</h2><p>The everyday money tools you expect, with privacy built in.</p></div>
              <div className="feature-grid">
                <button className="feature-card" onClick={() => goTo("pay", "send")}><span className="feature-icon"><SendIcon /></span><strong>Pay anyone</strong><p>Send {NATIVE} or pUSD to a wallet or a private address, with a private note only they can read.</p><span className="feature-link">Send money</span></button>
                <button className="feature-card" onClick={() => goTo("pay", "request")}><span className="feature-icon"><RequestIcon /></span><strong>Request & split</strong><p>Share a link or QR code for what a friend owes you, or split a bill. Private payments mark themselves paid.</p><span className="feature-link">Request money</span></button>
                <button className="feature-card" onClick={() => openTab("swap")}><span className="feature-icon"><SwapIcon /></span><strong>Swap</strong><p>Trade {NATIVE} and pUSD with a live quote and a guaranteed minimum, from or into your private balance.</p><span className="feature-link">Swap tokens</span></button>
                <button className="feature-card" onClick={() => openTab("transfer")}><span className="feature-icon"><LockIcon /></span><strong>Private account</strong><p>A private balance you can top up, send from and withdraw any time. Back up one key to restore it anywhere.</p><span className="feature-link">Open private account</span></button>
                <button className="feature-card" onClick={() => openTab("deposit")}><span className="feature-icon"><ShieldIcon /></span><strong>Shielded pools</strong><p>{configuredPoolCount ? `Deposit a fixed amount of ${assetNames} and withdraw it later to any address, unlinked.` : "Shielded pools are not available on this network yet."}</p><span className="feature-link">Shield funds</span></button>
                <button className="feature-card" onClick={() => openTab("auditor")}><span className="feature-icon"><KeyIcon /></span><strong>Viewing keys</strong><p>Show your history to someone you trust — an accountant or auditor — without giving them spending power.</p><span className="feature-link">Manage access</span></button>
              </div>

              <div className="section-title" id="how"><h2>How privacy works</h2><p>Three steps. Nothing to install beyond your wallet.</p></div>
              <div className="overview-lower">
                <div className="how-step"><span>1</span><strong>Add funds privately</strong><p>Top up your private balance from your wallet. The top-up is public; where the money goes next is not.</p></div>
                <div className="how-step"><span>2</span><strong>Pay and get paid</strong><p>Payments between private addresses are encrypted. Only the recipient can see the amount and your note.</p></div>
                <div className="how-step"><span>3</span><strong>Withdraw any time</strong><p>A zero-knowledge proof, made in your browser, shows you own funds in the pool without revealing which.</p></div>
              </div>

              <div className="trust-band">
                <div><h2>Testnet beta</h2><p>Umbra runs on the Portaldot V3 testnet with test tokens. Proofs are generated in your browser and verified on chain; the code is open source and audited internally.</p></div>
                {wallet ? <button className="primary" onClick={() => openTab("wallet")}>Go to wallet</button> : <button className="primary" onClick={pickNative} disabled={connecting}>Get started</button>}
              </div>
            </> : <>
              {isPrivacyTab(tab) && <nav className="privacy-nav" aria-label="Privacy tools">{privacyTools.map((p) => <button key={p.id} onClick={() => openTab(p.id)} aria-current={tab === p.id ? "page" : undefined}>{p.label}</button>)}</nav>}
              <div className="page-heading"><div><h1>{pageTitle}</h1><p>{pageDescription}</p></div></div>
              {["wallet", "pay", "swap"].includes(tab) ? (
                !wallet && !(tab === "pay" && payParam) ? connectPrompt("Connect to see your balances, pay friends and swap.")
                : <Suspense fallback={<div className="loading-panel" role="status">Loading…</div>}>
                  {tab === "wallet" && wallet && <WalletPanel wallet={wallet} onNavigate={goTo} />}
                  {tab === "pay" && <PayPanel wallet={wallet} sub={paySub} onSub={setPaySub} payParam={payParam} receiptParam={receiptParam} onConnect={pickNative} onClearLink={clearLink} />}
                  {tab === "swap" && wallet && <SwapPanel wallet={wallet} />}
                </Suspense>
              ) : !wallet ? connectPrompt("Connect to use your private account and shielded pools.") : <>
                {!configured && POOL_TABS.includes(tab) && <div className="notice-card"><span>ⓘ</span><div><strong>Not available on this network</strong><p>Shielded pools have not been set up here yet.</p></div></div>}
                {asset && POOL_TABS.includes(tab) && <div className="asset-toolbar"><div><span className="toolbar-label">Asset</span><div className="denoms">{assetList.map((a) => <button key={a.symbol} className={`chip ${a.symbol === assetSym ? "active" : ""}`} aria-pressed={a.symbol === assetSym} onClick={() => setAssetSym(a.symbol)}>{a.symbol}</button>)}</div></div><div><span className="toolbar-label">Pool size</span><div className="denoms">{denoms.map((d) => <button key={d} className={`chip ${d === denom ? "active" : ""}`} aria-pressed={d === denom} onClick={() => setDenom(d)}>{Number(d).toLocaleString()} {asset.symbol}</button>)}</div></div><div className="toolbar-summary"><span>Selected pool</span><strong>{Number(denom).toLocaleString()} {asset.symbol}</strong></div></div>}
                <Suspense fallback={<div className="loading-panel" role="status">Loading…</div>}>
                  {client && tab === "deposit" && asset && <DepositPanel key={poolAddr} asset={asset} denomLabel={denom} denomWei={ethers.parseUnits(denom, asset.decimals)} viewingKey={viewingKey} deposit={deposit} wallet={wallet} />}
                  {client && tab === "withdraw" && asset && <WithdrawPanel key={poolAddr} client={client} wallet={wallet} asset={asset} relayerUrl={RELAYER_URL} />}
                  {client && tab === "auditor" && asset && <AuditorPanel key={poolAddr} client={client} myViewingKey={viewingKey} denomLabel={denom} decimals={asset.decimals} symbol={asset.symbol} />}
                  {tab === "transfer" && (privateAccountReady ? <PrivateTransferPanel wallet={wallet} /> : <div className="notice-card"><span>ⓘ</span><div><strong>Not available on this network</strong><p>Private accounts have not been set up here yet.</p></div></div>)}
                </Suspense>
                {tab === "auditor" && <div className="key-actions">{wallet.kind === "native" && viewingKey && <CopyButton className="ghost" value={exportViewingKey(viewingKey)}>Copy viewing key</CopyButton>}{wallet.kind === "native" && <button className="ghost" onClick={() => { const v = prompt("Paste a previously exported viewing key (umbra-vk-…)"); if (v) { try { setViewingKey(restoreViewingKey(wallet, v)); } catch (e: any) { setConnectErr(e?.message || String(e)); } } }}>Restore viewing key</button>}{wallet.kind === "evm" && !viewingKey && <button className="ghost" onClick={async () => { try { setViewingKey(await getViewingKey(wallet)); } catch (e: any) { setConnectErr(e?.message || String(e)); } }}>Derive viewing key</button>}</div>}
              </>}
            </>}
            {connectErr && <div className="status err connect-error" role="alert"><span>{connectErr} {/Portaldot Extension/.test(connectErr) && <a href={PORTALDOT_EXTENSION_URL} target="_blank" rel="noreferrer">Install the Portaldot Extension</a>}</span><button aria-label="Dismiss error" onClick={() => setConnectErr(null)}>×</button></div>}
            {nativeAccounts && <div className="account-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setNativeAccounts(null); }}><div className="account-picker card" ref={accountPickerRef} onKeyDown={keepFocusInPicker} role="dialog" aria-modal="true" aria-labelledby="account-picker-title"><div className="picker-top"><div><h2 id="account-picker-title">Choose an account</h2><p className="hint" style={{ margin: "4px 0 0" }}>Umbra will ask this wallet to sign each transaction.</p></div><button aria-label="Close account picker" onClick={() => setNativeAccounts(null)}>×</button></div>{nativeAccounts.map((a) => <button key={a.address} className="account-option" onClick={() => chooseNative(a)}><span className="account-option-icon">{(a.name || "A").slice(0, 1).toUpperCase()}</span><span><strong>{a.name || "Account"}</strong><small className="mono">{short(a.address)} · {a.source}</small></span><span aria-hidden="true"><ArrowRightIcon /></span></button>)}</div></div>}
          </div>
          <footer className="workspace-footer">
            <span className="footer-brand"><img src="/umbra-mark.svg" width="22" height="22" alt="" /><span>umbra<span className="brand-period">.</span></span></span>
            <span>Private payments on Portaldot. Privacy improves as more people use the pools.</span>
            <span className="footer-links">{REPO_URL && <a href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>}<a href={PORTALDOT_EXTENSION_URL} target="_blank" rel="noreferrer">Portaldot Extension</a></span>
          </footer>
        </main>
      </div>
    </div>
    </PrivateAccountProvider>
  );
}
