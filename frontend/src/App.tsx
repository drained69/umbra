import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { UmbraPoolClient, UmbraNative, exportViewingKey, type Note } from "@umbra/sdk";
import { DEPLOYMENT, NATIVE, HAS_EVM_RPC, assets, format, getApi, readProvider, short, blockLink, PORTALDOT_EXTENSION_URL } from "./lib/chain";
import { connectEvm, connectNative, getViewingKey, listNativeAccounts, restoreViewingKey, type NativeAccount, type Wallet } from "./lib/wallet";
import DepositPanel, { type TxRef } from "./components/DepositPanel";
import WithdrawPanel from "./components/WithdrawPanel";
import AuditorPanel from "./components/AuditorPanel";
import DeployPanel from "./components/DeployPanel";
import DeploymentSummary from "./components/DeploymentSummary";
import PrivateTransferPanel from "./components/PrivateTransferPanel";

type Tab = "overview" | "deposit" | "withdraw" | "transfer" | "auditor";
const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL || "";
const NET_LABEL = DEPLOYMENT.network === "portaldot-v3-live" ? "Mainnet V3.0" : "Testnet";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAccount[] | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("");
  const [tab, setTab] = useState<Tab>("overview");
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);
  const [showDeploy, setShowDeploy] = useState(() => new URLSearchParams(location.search).has("deploy"));
  const contracts = DEPLOYMENT.contracts;
  const deploymentReady = [contracts.poseidon, contracts.withdrawVerifier, contracts.transactionVerifier, contracts.shieldedPool,
    contracts.pools?.["100"], contracts.pools?.["1000"], contracts.tokens?.pUSD?.pools?.["100"], contracts.tokens?.pUSD?.pools?.["1000"]]
    .every((address) => ethers.isAddress(address) && address !== ethers.ZeroAddress);

  const assetList = useMemo(() => assets(), []);
  const [assetSym, setAssetSym] = useState(assetList[0]?.symbol ?? "tPOT");
  const asset = assetList.find((a) => a.symbol === assetSym);
  const denoms = asset ? Object.keys(asset.pools) : [];
  const [denom, setDenom] = useState<string>(denoms[0] ?? "");
  useEffect(() => setDenom(Object.keys(asset?.pools ?? {})[0] ?? ""), [assetSym]);
  const poolAddr = asset?.pools[denom];
  const configured = !!poolAddr && poolAddr !== ethers.ZeroAddress;

  const client = useMemo(() => {
    if (!configured || !asset) return null;
    const runner = wallet?.kind === "evm" ? wallet.signer : readProvider;
    return new UmbraPoolClient(poolAddr!, runner, { deployBlock: DEPLOYMENT.deployBlock ?? 0, assetRules: asset.rules });
  }, [wallet, poolAddr, configured, asset]);

  // balances
  useEffect(() => {
    if (!wallet) return;
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
    })().catch(() => {});
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
      setNativeAccounts(accounts);
      if (accounts.length === 1) await chooseNative(accounts[0]);
    } catch (e: any) {
      setConnectErr(e.message);
    }
  }
  async function chooseNative(a: NativeAccount) {
    const w = await connectNative(a);
    setWallet(w);
    setNativeAccounts(null);
    setViewingKey(await getViewingKey(w));
  }
  async function pickEvm() {
    setConnectErr(null);
    try {
      setWallet(await connectEvm());
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
    { id: "overview", label: "Overview", detail: "Your workspace", icon: "◫" },
    { id: "deposit", label: "Shield assets", detail: "Private deposits", icon: "↙" },
    { id: "withdraw", label: "Withdraw", detail: "Private transfers", icon: "↗" },
    { id: "transfer", label: "Private account", detail: "Send shielded funds", icon: "⇄" },
    { id: "auditor", label: "Activity & keys", detail: "Selective disclosure", icon: "◎" },
  ];
  const current = navigation.find((item) => item.id === tab)!;
  const openTab = (next: Tab) => { setTab(next); setShowDeploy(false); };
  const pageTitle = showDeploy ? "Contracts" : current.label;
  const pageDescription = showDeploy
    ? "The verified infrastructure behind every private transaction."
    : tab === "overview" ? "A quieter way to move value on Portaldot."
    : tab === "deposit" ? "Move funds into a fixed-size private pool."
    : tab === "withdraw" ? "Create a proof and release funds to your recipient."
    : tab === "transfer" ? "Move value between shielded accounts without revealing individual amounts."
    : "Explore encrypted activity with a read-only viewing key.";

  return (
    <div className="workspace">
      <aside className="app-sidebar">
        <div className="brand-lockup" onClick={() => openTab("overview")} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") openTab("overview"); }}>
          <span className="brand-symbol"><span /></span>
          <span><strong>umbra</strong><small>PRIVATE FINANCE</small></span>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="app-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.id} className={`nav-item ${!showDeploy && tab === item.id ? "active" : ""}`} onClick={() => openTab(item.id)}><span className="nav-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span><span className="nav-chevron">›</span></button>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="status-orb" /><div><strong>Portaldot V3</strong><small>{NET_LABEL} · connected</small></div></div>
        <button className={`sidebar-contracts ${showDeploy ? "active" : ""}`} onClick={() => setShowDeploy(true)}><span>◇</span> Contract registry <span>↗</span></button>
        <div className="sidebar-footer">PRIVATE BY DESIGN <span>© UMBRA</span></div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-separator">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-right">
            <span className="environment-tag"><i />{NET_LABEL}</span>
            {wallet ? <><span className="account-tag" title={wallet.kind === "native" ? wallet.account : wallet.address}><span className="account-avatar">{(wallet.kind === "native" ? wallet.label : "EVM").slice(0, 1).toUpperCase()}</span><span>{wallet.kind === "native" ? wallet.label : short(wallet.address)}</span>{balance && <small>{Number(balance).toFixed(2)} {NATIVE}</small>}</span>{wallet.kind === "native" && <button className="text-button" onClick={pickNative}>Switch</button>}</> : <button className="topbar-connect" onClick={pickNative}>Connect wallet <span>↗</span></button>}
          </div>
        </header>

        <main className="workspace-scroll">
          <div className="content-wrap">
            {showDeploy ? <>
              <div className="page-kicker">INFRASTRUCTURE <span> / </span> 01</div>
              <div className="page-heading"><div><h1>Contract registry<span className="heading-period">.</span></h1><p>{pageDescription}</p></div><button className="subtle-button" onClick={() => setShowDeploy(false)}>← Back to workspace</button></div>
              {deploymentReady ? <DeploymentSummary onBack={() => setShowDeploy(false)} /> : wallet?.kind === "native" ? <DeployPanel key={wallet.account} wallet={wallet} /> : <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect to deploy</h2><p>Your Portaldot Extension signs each deployment step. Your keys stay in your wallet.</p><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button></div>}
            </> : tab === "overview" ? <>
              <section className="hero-panel">
                <div className="hero-copy"><div className="hero-eyebrow"><span className="hero-eyebrow-line" /> CONFIDENTIAL TRANSACTIONS · PORTALDOT V3</div><h1>Move value.<br /><em>Leave no trail.</em></h1><p>Shield your assets, withdraw with a zero-knowledge proof, and reveal your history only when you choose.</p><div className="hero-actions"><button className="hero-primary" onClick={() => openTab("deposit")}>Shield assets <span>↗</span></button><button className="hero-secondary" onClick={() => openTab("withdraw")}>Make a withdrawal <span>→</span></button></div></div>
                <div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="hero-core"><span>◈</span></div><div className="float-label float-label-top">ZERO KNOWLEDGE <span>✓</span></div><div className="float-label float-label-bottom">YOUR PRIVACY, YOUR CALL</div></div>
              </section>
              <div className="section-title"><div><span className="page-kicker">GET STARTED <span> / </span> 02</span><h2>Your private workspace</h2><p>Everything you need to transact confidentially.</p></div><span className="section-index">01 — 03</span></div>
                <div className="feature-grid">
                <button className="feature-card" onClick={() => openTab("deposit")}><span className="feature-number">01 / SHIELD</span><span className="feature-icon lavender">↙</span><strong>Shield assets</strong><p>Deposit into a fixed-size pool and create your private note.</p><span className="feature-link">Start shielding <b>↗</b></span></button>
                <button className="feature-card" onClick={() => openTab("withdraw")}><span className="feature-number">02 / TRANSFER</span><span className="feature-icon peach">↗</span><strong>Withdraw privately</strong><p>Prove ownership without revealing which deposit was yours.</p><span className="feature-link">Make a withdrawal <b>↗</b></span></button>
                <button className="feature-card" onClick={() => openTab("auditor")}><span className="feature-number">03 / DISCLOSE</span><span className="feature-icon mint">◎</span><strong>Activity & keys</strong><p>Inspect encrypted activity or share read-only access on your terms.</p><span className="feature-link">Explore activity <b>↗</b></span></button>
              </div>
              <div className="notice-card" style={{ marginTop: 20 }}><span>⇄</span><div><strong>Send from a private account</strong><p>Deposit any amount of {NATIVE}, then transfer it to another shielded address.</p></div><button onClick={() => openTab("transfer")}>Open private account ↗</button></div>
              <div className="overview-lower">
                <div className="network-card"><div className="network-card-top"><span className="network-symbol">◈</span><span className={`live-pill ${deploymentReady ? "" : "pending"}`}><i />{deploymentReady ? "LIVE ON TESTNET" : "SETUP REQUIRED"}</span></div><h3>{deploymentReady ? "Infrastructure is ready." : "Infrastructure pending."}</h3><p>{deploymentReady ? "Eight contracts, four fixed pools, and the private transfer engine are configured for this app." : "Deploy the pools and verifiers to enable private transactions."}</p><div className="network-card-bottom"><span>PORTALDOT V3 · {NET_LABEL.toUpperCase()}</span><button onClick={() => setShowDeploy(true)}>View contracts ↗</button></div></div>
                <div className="how-card"><span className="page-kicker">HOW IT WORKS</span><h3>Privacy without compromise.</h3><div className="how-step"><span>01</span><div><strong>Deposit into a shared pool</strong><p>Your wallet funds a pool with a fixed denomination.</p></div></div><div className="how-step"><span>02</span><div><strong>Keep your note secure</strong><p>It is the secret needed to withdraw later.</p></div></div><div className="how-step"><span>03</span><div><strong>Withdraw with a proof</strong><p>The chain verifies ownership without linking your deposit.</p></div></div></div>
              </div>
            </> : <>
              <div className="page-kicker">PRIVATE WORKSPACE <span> / </span> {tab === "deposit" ? "01" : tab === "withdraw" ? "02" : tab === "transfer" ? "03" : "04"}</div>
              <div className="page-heading"><div><h1>{pageTitle}<span className="heading-period">.</span></h1><p>{pageDescription}</p></div><div className="page-privacy-badge"><span>◈</span> Built for your privacy</div></div>
              <div className="flow-intro"><div className={`flow-icon ${tab}`}>{current.icon}</div><div><strong>{tab === "deposit" ? "Start with a private deposit" : tab === "withdraw" ? "Your proof, your withdrawal" : tab === "transfer" ? "Send inside the private pool" : "You decide what to reveal"}</strong><p>{tab === "deposit" ? "Generate a note locally, save it, then sign your deposit." : tab === "withdraw" ? "Enter a saved note and recipient to build a proof in your browser." : tab === "transfer" ? "Create a shielded address, save its spend key, then deposit and send." : "Read-only keys can reveal pool history without spending authority."}</p></div><span className="flow-secure">END-TO-END PRIVACY</span></div>
              {!wallet ? <div className="wallet-prompt"><span className="prompt-icon">⌁</span><h2>Connect your wallet</h2><p>Connect to use the private pools. Your signing keys never leave your extension.</p><div className="prompt-buttons"><button className="primary" onClick={pickNative}>Connect Portaldot <span>↗</span></button>{HAS_EVM_RPC && <button className="ghost" onClick={pickEvm}>Use EVM wallet</button>}</div></div> : <>
                {!configured && tab !== "transfer" && <div className="notice-card"><span>ⓘ</span><div><strong>Pool setup required</strong><p>Deploy a pool before using this action.</p></div>{wallet.kind === "native" && <button onClick={() => setShowDeploy(true)}>View setup ↗</button>}</div>}
                {asset && tab !== "transfer" && <div className="asset-toolbar"><div><span className="toolbar-label">01 · ASSET</span><div className="denoms">{assetList.map((a) => <button key={a.symbol} className={`chip ${a.symbol === assetSym ? "active" : ""}`} onClick={() => setAssetSym(a.symbol)}>{a.symbol}</button>)}</div></div><div><span className="toolbar-label">02 · POOL SIZE</span><div className="denoms">{denoms.map((d) => <button key={d} className={`chip ${d === denom ? "active" : ""}`} onClick={() => setDenom(d)}>{d} {asset.symbol}</button>)}</div></div><div className="toolbar-summary"><span>SELECTED POOL</span><strong>{denom} {asset.symbol}</strong></div></div>}
                {client && tab === "deposit" && asset && <DepositPanel asset={asset} denomLabel={denom} denomWei={ethers.parseUnits(denom, asset.decimals)} viewingKey={viewingKey} deposit={deposit} wallet={wallet} />}
                {client && tab === "withdraw" && asset && <WithdrawPanel client={client} wallet={wallet} asset={asset} relayerUrl={RELAYER_URL} />}
                {client && tab === "auditor" && asset && <AuditorPanel client={client} myViewingKey={viewingKey} denomLabel={denom} decimals={asset.decimals} symbol={asset.symbol} />}
                {tab === "transfer" && (ethers.isAddress(contracts.shieldedPool) ? <PrivateTransferPanel wallet={wallet} /> : <div className="notice-card"><span>ⓘ</span><div><strong>Private transfer pool required</strong><p>Deploy the join-split pool to enable private accounts.</p></div></div>)}
                {tab === "auditor" && <div className="key-actions">{wallet.kind === "native" && viewingKey && <button className="ghost" onClick={() => navigator.clipboard.writeText(exportViewingKey(viewingKey))}>Export viewing key</button>}{wallet.kind === "native" && <button className="ghost" onClick={() => { const v = prompt("Paste a previously exported viewing key (umbra-vk-…)"); if (v) setViewingKey(restoreViewingKey(wallet, v)); }}>Restore viewing key</button>}{wallet.kind === "evm" && !viewingKey && <button className="ghost" onClick={async () => setViewingKey(await getViewingKey(wallet))}>Derive viewing key</button>}</div>}
              </>}
            </>}
            {connectErr && <div className="status err connect-error">{connectErr} {/Portaldot Extension/.test(connectErr) && <a href={PORTALDOT_EXTENSION_URL} target="_blank" rel="noreferrer">Install extension ↗</a>}</div>}
            {nativeAccounts && <div className="account-overlay" onClick={() => setNativeAccounts(null)}><div className="account-picker card" onClick={(e) => e.stopPropagation()}><div className="picker-top"><div><span className="page-kicker">YOUR WALLET</span><h2>Choose an account</h2></div><button aria-label="Close account picker" onClick={() => setNativeAccounts(null)}>×</button></div>{nativeAccounts.map((a) => <button key={a.address} className="account-option" onClick={() => chooseNative(a)}><span className="account-option-icon">{(a.name || "A").slice(0, 1)}</span><span><strong>{a.name || "Account"}</strong><small className="mono">{short(a.address)} · {a.source}</small></span><span>↗</span></button>)}</div></div>}
          </div>
          <footer className="workspace-footer"><span>UMBRA / PRIVATE FINANCE</span><span>Secured by zero-knowledge proofs · {NET_LABEL}</span></footer>
        </main>
      </div>
    </div>
  );
}
