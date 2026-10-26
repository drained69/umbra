import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { UmbraPoolClient, UmbraNative, exportViewingKey, type Note } from "@umbra/sdk";
import { DEPLOYMENT, NATIVE, HAS_EVM_RPC, assets, isCrossVmPool, format, getApi, readProvider, short, blockLink, PORTALDOT_EXTENSION_URL } from "./lib/chain";
import { connectEvm, connectNative, getViewingKey, listNativeAccounts, restoreViewingKey, type NativeAccount, type Wallet } from "./lib/wallet";
import type { TxRef } from "./components/DepositPanel";
import DeploymentSummary from "./components/DeploymentSummary";
import { PrivateAccountProvider } from "./lib/privateAccount";
import type { PaySub } from "./components/PayPanel";

const WalletPanel = lazy(() => import("./components/WalletPanel"));
const PayPanel = lazy(() => import("./components/PayPanel"));
const SwapPanel = lazy(() => import("./components/SwapPanel"));
const DepositPanel = lazy(() => import("./components/DepositPanel"));
const WithdrawPanel = lazy(() => import("./components/WithdrawPanel"));
const AuditorPanel = lazy(() => import("./components/AuditorPanel"));
const DeployPanel = lazy(() => import("./components/DeployPanel"));
const CrossVmDeployPanel = lazy(() => import("./components/CrossVmDeployPanel"));
const PrivateTransferPanel = lazy(() => import("./components/PrivateTransferPanel"));

type Tab = "overview" | "wallet" | "pay" | "swap" | "deposit" | "withdraw" | "transfer" | "auditor";
/** Tabs that act on one fixed-size pool and show the asset / pool-size toolbar. */
const POOL_TABS: Tab[] = ["deposit", "withdraw", "auditor"];
const LINK = new URLSearchParams(location.search);
const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL || "";
const NET_LABEL = DEPLOYMENT.network === "portaldot-v3-live" ? "Portaldot V3 live" : "Portaldot V3 testnet";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAccount[] | null>(null);
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
    history.replaceState(null, "", location.pathname);
  };
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);
  const [showDeploy, setShowDeploy] = useState(() => new URLSearchParams(location.search).has("deploy"));
  const [crossVmSetup, setCrossVmSetup] = useState(() => new URLSearchParams(location.search).has("crossvm"));
  const accountPickerRef = useRef<HTMLDivElement>(null);
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
  const deploymentReady = [contracts.poseidon, contracts.withdrawVerifier, contracts.transactionVerifier, contracts.shieldedPool,
    contracts.pools?.["100"], contracts.pools?.["1000"], contracts.tokens?.pUSD?.pools?.["100"], contracts.tokens?.pUSD?.pools?.["1000"]]
    .every((address) => ethers.isAddress(address) && address !== ethers.ZeroAddress);

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
    setConnectErr(null);
    try {
      const { extensions, accounts } = await listNativeAccounts();
      if (!extensions.length) throw new Error("No Portaldot Extension found.");
      if (!accounts.length) throw new Error("The extension has no accounts (or access was denied).");
      if (accounts.length === 1) await chooseNative(accounts[0]);
      else setNativeAccounts(accounts);
    } catch (e: any) {
      setConnectErr(e.message);
    }
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
    setConnectErr(null);
    try {
      setWallet(await connectEvm());
      setViewingKey(null);
    } catch (e: any) {
      setConnectErr(e.message);
    }
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

  const navigation: { id: Tab; label: string; detail: string; icon: string }[] = [
    { id: "overview", label: "Overview", detail: "How Umbra works", icon: "00" },
    { id: "wallet", label: "Wallet", detail: "Balances & contacts", icon: "01" },
    { id: "pay", label: "Pay", detail: "Send, request, split", icon: "02" },
    { id: "swap", label: "Swap", detail: "tPOT ↔ pUSD", icon: "03" },
    { id: "transfer", label: "Private account", detail: "Send shielded tPOT", icon: "04" },
    { id: "deposit", label: "Shield", detail: "Fixed-size pool", icon: "05" },
    { id: "withdraw", label: "Withdraw", detail: "Spend a private note", icon: "06" },
    { id: "auditor", label: "Keys", detail: "Read-only access", icon: "07" },
  ];
  const current = navigation.find((item) => item.id === tab)!;
  const openTab = (next: Tab) => { setTab(next); setShowDeploy(false); setCrossVmSetup(false); };
  const goTo = (next: "pay" | "swap", sub?: PaySub) => { if (sub) setPaySub(sub); openTab(next); };
  const pageTitle = showDeploy ? "Contracts" : payParam && tab === "pay" ? "Pay a request" : current.label;
  const pageDescription = showDeploy
    ? "Review the contracts configured for this app."
    : tab === "overview" ? "A private layer for moving value on Portaldot."
    : tab === "wallet" ? "Your public and private balances, ways to get paid, and the people you pay."
    : tab === "pay" ? (payParam ? "Someone sent you a payment request." : "Pay anyone, request money from friends, or split a bill.")
    : tab === "swap" ? "Trade tPOT and pUSD on Portaldot's built-in DEX, from your wallet or your private balance."
    : tab === "deposit" ? "Create a note locally, back it up, and deposit into a fixed-size pool."
    : tab === "withdraw" ? "Prove ownership of an unspent note and send funds to a recipient."
    : tab === "transfer" ? "Move value between shielded accounts. Your gas-paying wallet remains public."
    : "Inspect encrypted activity and manage read-only viewing access.";

  return (
    <PrivateAccountProvider>
    <div className="workspace">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <button className="brand-lockup" type="button" onClick={() => openTab("overview")} aria-label="Umbra overview">
          <span className="brand-symbol" aria-hidden="true">◐</span><strong>umbra</strong>
        </button>
        <nav className="app-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.id} className={`nav-item ${!showDeploy && tab === item.id ? "active" : ""}`} aria-current={!showDeploy && tab === item.id ? "page" : undefined} onClick={() => openTab(item.id)}><span className="nav-icon">{item.icon}</span><strong>{item.label}</strong></button>)}
        </nav>
        <div className="topbar-right">
          <span className="environment-tag"><i />{NET_LABEL}</span>
          {wallet ? <><span className="account-tag" title={wallet.kind === "native" ? wallet.account : wallet.address}><span className="account-avatar">{(wallet.kind === "native" ? wallet.label : "EVM").slice(0, 1).toUpperCase()}</span><span>{wallet.kind === "native" ? wallet.label : short(wallet.address)}</span>{balance && <small>{Number(balance).toFixed(2)} {NATIVE}</small>}</span><button className="text-button" onClick={wallet.kind === "native" ? pickNative : pickEvm}>Switch</button></> : <button className="topbar-connect" onClick={pickNative}>Connect Portaldot <span aria-hidden="true">↗</span></button>}
        </div>
      </header>

      <div className="workspace-main">
        <main className="workspace-scroll" id="main-content">
          <div className="content-wrap">
            {showDeploy ? <>
              <div className="page-kicker">INFRASTRUCTURE <span> / </span> 01</div>
              <div className="page-heading"><div><h1>Contract registry</h1><p>{pageDescription}</p></div><button className="subtle-button" onClick={() => openTab("overview")}>← Overview</button></div>
              {crossVmSetup && deploymentReady ? (wallet?.kind === "native" ? <Suspense fallback={<div className="loading-panel" role="status">Loading deployment tools…</div>}><CrossVmDeployPanel key={wallet.account} wallet={wallet} /></Suspense> : <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect to deploy</h2><p>Your Portaldot Extension signs the WASM and EVM deployment steps. Your keys stay in your wallet.</p><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button></div>)
                : deploymentReady ? <DeploymentSummary onBack={() => setShowDeploy(false)} onSetUpCrossVm={() => setCrossVmSetup(true)} /> : wallet?.kind === "native" ? <Suspense fallback={<div className="loading-panel" role="status">Loading deployment tools…</div>}><DeployPanel key={wallet.account} wallet={wallet} /></Suspense> : <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect to deploy</h2><p>Your Portaldot Extension signs each deployment step. Your keys stay in your wallet.</p><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button></div>}
            </> : tab === "overview" ? <>
              <section className="hero-panel" aria-labelledby="hero-title">
                <div className="hero-visual" aria-hidden="true"><svg viewBox="0 0 480 270" fill="none"><circle cx="240" cy="135" r="114" stroke="currentColor" strokeDasharray="3 8" opacity=".35"/><circle cx="240" cy="135" r="79" stroke="currentColor" opacity=".24"/><path d="M64 135h82m188 0h82M240 20v37m0 156v37" stroke="currentColor" opacity=".55"/><path d="M146 135c31-42 56-62 94-62s63 20 94 62c-31 42-56 62-94 62s-63-20-94-62Z" stroke="currentColor" strokeWidth="2"/><circle cx="240" cy="135" r="43" stroke="currentColor" strokeWidth="2"/><circle cx="240" cy="135" r="13" fill="currentColor"/><circle cx="64" cy="135" r="5" fill="currentColor"/><circle cx="416" cy="135" r="5" fill="currentColor"/><text x="20" y="116">PUBLIC INPUT</text><text x="356" y="116">PRIVATE STATE</text></svg></div>
                <div className="hero-copy"><div className="hero-eyebrow"><span className="status-orb" /> PRIVATE FINANCE / PORTALDOT V3</div><h1 id="hero-title">A private layer<br />for <em>moving value.</em></h1><p>Shield assets, send within a private account, and withdraw with a zero-knowledge proof. Choose what to reveal with a read-only viewing key.</p><div className="hero-actions"><button className="hero-primary" onClick={() => openTab("transfer")}>Open private account <span aria-hidden="true">↗</span></button><button className="hero-secondary" onClick={() => openTab("deposit")}>Shield assets <span aria-hidden="true">→</span></button></div><small className="hero-disclosure">Deposits, withdrawals, pool sizes, and gas payers may be visible.</small></div>
              </section>
              <div className="overview-facts" aria-label="Umbra capabilities"><div><strong>{String(configuredAssets.length).padStart(2, "0")}</strong><span>ASSET TYPES CONFIGURED</span></div><div><strong>{String(configuredPoolCount).padStart(2, "0")}</strong><span>FIXED POOLS CONFIGURED</span></div><div><strong>{privateAccountReady ? "01" : "00"}</strong><span>PRIVATE ACCOUNT ENGINE</span></div><div><strong>{deploymentReady ? "READY" : "SETUP"}</strong><span>APP CONFIGURATION</span></div></div>
              <div className="section-title"><div><span className="page-kicker">01 / USE UMBRA</span><h2>Choose your next move.</h2><p>Each action has a clear privacy boundary.</p></div><span className="section-index">WORKING FLOWS</span></div>
              <div className="feature-grid">
                <button className="feature-card" onClick={() => goTo("pay", "send")}><span className="feature-number">01 / PAY</span><span className="feature-icon">→</span><strong>Pay anyone</strong><p>Send {NATIVE} or pUSD to a friend. Pay a private address and the chain does not show who received it or how much.</p><span className="feature-link">Send ↗</span></button>
                <button className="feature-card" onClick={() => goTo("pay", "request")}><span className="feature-number">02 / REQUEST</span><span className="feature-icon">↙</span><strong>Request & split</strong><p>Share a link or QR code for what a friend owes you, or split a bill. Private payments are matched automatically.</p><span className="feature-link">Request ↗</span></button>
                <button className="feature-card" onClick={() => openTab("swap")}><span className="feature-number">03 / SWAP</span><span className="feature-icon">⇅</span><strong>Swap</strong><p>Trade {NATIVE} and pUSD on Portaldot's built-in DEX, straight from or into your private balance.</p><span className="feature-link">Swap ↗</span></button>
                <button className="feature-card" onClick={() => openTab("deposit")}><span className="feature-number">04 / FIXED POOLS</span><span className="feature-icon">↘</span><strong>Shield assets</strong><p>{configuredPoolCount ? `Deposit ${assetNames} into a fixed-size pool.` : "Configure a fixed-size pool to shield assets."} Keep the note secret needed to withdraw.</p><span className="feature-link">Start shielding ↗</span></button>
                <button className="feature-card" onClick={() => openTab("transfer")}><span className="feature-number">05 / PRIVATE ACCOUNT</span><span className="feature-icon">⇄</span><strong>Send privately</strong><p>Create a shielded account and transfer {NATIVE} to another shielded address.</p><span className="feature-link">Open account ↗</span></button>
                <button className="feature-card" onClick={() => openTab("withdraw")}><span className="feature-number">06 / ZERO KNOWLEDGE</span><span className="feature-icon">↗</span><strong>Withdraw with proof</strong><p>Spend a note without revealing which deposit in its pool you owned.</p><span className="feature-link">Withdraw ↗</span></button>
                <button className="feature-card" onClick={() => openTab("auditor")}><span className="feature-number">07 / DISCLOSURE</span><span className="feature-icon">◎</span><strong>Viewing keys</strong><p>Review encrypted activity and manage read-only access.</p><span className="feature-link">Review activity ↗</span></button>
              </div>
              <div className="overview-lower">
                <div className="network-card"><span className="page-kicker">02 / THE MODEL</span><h3>Public entry. Private movement.</h3><p>Umbra separates a public wallet transaction from the secret note that authorizes a later spend. A proof verifies ownership; a nullifier prevents double spending.</p><button onClick={() => openTab("auditor")}>See what the chain can observe ↗</button></div>
                <div className="how-card"><span className="page-kicker">03 / THE FLOW</span><div className="how-step"><span>01</span><div><strong>Enter a pool</strong><p>The deposit and pool size are public.</p></div></div><div className="how-step"><span>02</span><div><strong>Keep the secret</strong><p>Your note or spend key stays with you.</p></div></div><div className="how-step"><span>03</span><div><strong>Spend with a proof</strong><p>The chain verifies ownership without exposing the note.</p></div></div></div>
              </div>
              <div className="roadmap-band"><div><span className="page-kicker">04 / BUILDING NEXT</span><h2>Cross-chain next.</h2><p>An operator bridge from Ethereum Sepolia and batched private DEX trades are in local testing. They are not live app actions yet.</p></div><button onClick={() => setShowDeploy(true)}>View configured contracts ↗</button></div>
            </> : <>
              <div className="page-kicker">{["wallet", "pay", "swap"].includes(tab) ? "MONEY" : "PRIVATE WORKSPACE"} <span> / </span> {current.icon}</div>
              <div className="page-heading"><div><h1>{pageTitle}</h1><p>{pageDescription}</p></div><div className="page-privacy-badge">LOCAL PROOFS / PUBLIC SETTLEMENT</div></div>
              {["wallet", "pay", "swap"].includes(tab) ? (
                !wallet && !(tab === "pay" && payParam) ? <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect your wallet</h2><p>Connect to see balances, pay friends and swap. Your signing keys never leave your extension.</p><div className="prompt-buttons"><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button>{HAS_EVM_RPC && <button className="ghost" onClick={pickEvm}>Use EVM wallet</button>}</div></div>
                : <Suspense fallback={<div className="loading-panel" role="status">Loading…</div>}>
                  {tab === "wallet" && wallet && <WalletPanel wallet={wallet} onNavigate={goTo} />}
                  {tab === "pay" && <PayPanel wallet={wallet} sub={paySub} onSub={setPaySub} payParam={payParam} receiptParam={receiptParam} onConnect={pickNative} onClearLink={clearLink} />}
                  {tab === "swap" && wallet && <SwapPanel wallet={wallet} />}
                </Suspense>
              ) : <>
              <div className="flow-intro"><div className={`flow-icon ${tab}`}>{current.icon}</div><div><strong>{tab === "deposit" ? "Start with a private note" : tab === "withdraw" ? "Your proof, your withdrawal" : tab === "transfer" ? "Send inside the private pool" : "You decide what to reveal"}</strong><p>{tab === "deposit" ? "Generate a note locally, back it up, then sign your public deposit." : tab === "withdraw" ? "Enter a saved note and recipient to build a proof in your browser." : tab === "transfer" ? "Create a shielded address, save its spend key, then deposit and send." : "Read-only keys can reveal pool history without spending authority."}</p></div><span className="flow-secure">CHECK WHAT IS VISIBLE BELOW</span></div>
              {!wallet ? <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect your wallet</h2><p>Connect to use the private pools. Your signing keys never leave your extension.</p><div className="prompt-buttons"><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button>{HAS_EVM_RPC && <button className="ghost" onClick={pickEvm}>Use EVM wallet</button>}</div></div> : <>
                {!configured && POOL_TABS.includes(tab) && <div className="notice-card"><span>ⓘ</span><div><strong>Pool setup required</strong><p>Deploy a pool before using this action.</p></div>{wallet.kind === "native" && <button onClick={() => setShowDeploy(true)}>View setup ↗</button>}</div>}
                {asset && POOL_TABS.includes(tab) && <div className="asset-toolbar"><div><span className="toolbar-label">01 · ASSET</span><div className="denoms">{assetList.map((a) => <button key={a.symbol} className={`chip ${a.symbol === assetSym ? "active" : ""}`} aria-pressed={a.symbol === assetSym} onClick={() => setAssetSym(a.symbol)}>{a.symbol}</button>)}</div></div><div><span className="toolbar-label">02 · POOL SIZE</span><div className="denoms">{denoms.map((d) => <button key={d} className={`chip ${d === denom ? "active" : ""}`} aria-pressed={d === denom} onClick={() => setDenom(d)}>{d} {asset.symbol}{isCrossVmPool(asset.pools[d]) ? " · WASM" : ""}</button>)}</div></div><div className="toolbar-summary"><span>SELECTED POOL</span><strong>{denom} {asset.symbol}</strong></div></div>}
                <Suspense fallback={<div className="loading-panel" role="status">Loading workspace…</div>}>
                  {client && tab === "deposit" && asset && <DepositPanel key={poolAddr} asset={asset} denomLabel={denom} denomWei={ethers.parseUnits(denom, asset.decimals)} viewingKey={viewingKey} deposit={deposit} wallet={wallet} />}
                  {client && tab === "withdraw" && asset && <WithdrawPanel key={poolAddr} client={client} wallet={wallet} asset={asset} relayerUrl={RELAYER_URL} />}
                  {client && tab === "auditor" && asset && <AuditorPanel key={poolAddr} client={client} myViewingKey={viewingKey} denomLabel={denom} decimals={asset.decimals} symbol={asset.symbol} />}
                  {tab === "transfer" && (privateAccountReady ? <PrivateTransferPanel wallet={wallet} /> : <div className="notice-card"><span>ⓘ</span><div><strong>Private transfer pool required</strong><p>Deploy the join-split pool to enable private accounts.</p></div></div>)}
                </Suspense>
                {tab === "auditor" && <div className="key-actions">{wallet.kind === "native" && viewingKey && <button className="ghost" onClick={() => navigator.clipboard.writeText(exportViewingKey(viewingKey))}>Copy viewing key</button>}{wallet.kind === "native" && <button className="ghost" onClick={() => { const v = prompt("Paste a previously exported viewing key (umbra-vk-…)"); if (v) { try { setViewingKey(restoreViewingKey(wallet, v)); } catch (e: any) { setConnectErr(e?.message || String(e)); } } }}>Restore viewing key</button>}{wallet.kind === "evm" && !viewingKey && <button className="ghost" onClick={async () => { try { setViewingKey(await getViewingKey(wallet)); } catch (e: any) { setConnectErr(e?.message || String(e)); } }}>Derive viewing key</button>}</div>}
              </>}
              </>}
            </>}
            {connectErr && <div className="status err connect-error" role="alert">{connectErr} {/Portaldot Extension/.test(connectErr) && <a href={PORTALDOT_EXTENSION_URL} target="_blank" rel="noreferrer">Install extension ↗</a>}<button aria-label="Dismiss error" onClick={() => setConnectErr(null)}>×</button></div>}
            {nativeAccounts && <div className="account-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setNativeAccounts(null); }}><div className="account-picker card" ref={accountPickerRef} onKeyDown={keepFocusInPicker} role="dialog" aria-modal="true" aria-labelledby="account-picker-title"><div className="picker-top"><div><span className="page-kicker">YOUR WALLET</span><h2 id="account-picker-title">Choose an account</h2></div><button aria-label="Close account picker" onClick={() => setNativeAccounts(null)}>×</button></div>{nativeAccounts.map((a) => <button key={a.address} className="account-option" onClick={() => chooseNative(a)}><span className="account-option-icon">{(a.name || "A").slice(0, 1)}</span><span><strong>{a.name || "Account"}</strong><small className="mono">{short(a.address)} · {a.source}</small></span><span>↗</span></button>)}</div></div>}
          </div>
          <footer className="workspace-footer"><span>◐ UMBRA / PRIVATE FINANCE</span><span>Privacy depends on pool activity and how you submit transactions.</span><button onClick={() => setShowDeploy(true)}>Contracts ↗</button></footer>
        </main>
      </div>
    </div>
    </PrivateAccountProvider>
  );
}
