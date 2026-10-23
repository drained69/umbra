import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { UmbraPoolClient, UmbraNative, exportViewingKey, type Note } from "@umbra/sdk";
import { DEPLOYMENT, assets, format, getApi, readProvider, short, blockLink, PORTALDOT_EXTENSION_URL } from "./lib/chain";
import { connectEvm, connectNative, getViewingKey, listNativeAccounts, restoreViewingKey, type NativeAccount, type Wallet } from "./lib/wallet";
import DepositPanel, { type TxRef } from "./components/DepositPanel";
import WithdrawPanel from "./components/WithdrawPanel";
import AuditorPanel from "./components/AuditorPanel";
import DeployPanel from "./components/DeployPanel";

type Tab = "deposit" | "withdraw" | "auditor";
const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL || "http://localhost:8787";

export default function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [nativeAccounts, setNativeAccounts] = useState<NativeAccount[] | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("");
  const [tab, setTab] = useState<Tab>("deposit");
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);
  const [showDeploy, setShowDeploy] = useState(() => new URLSearchParams(location.search).has("deploy"));

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

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1>Umbra</h1>
            <div className="sub">Confidential POT &amp; Portaldot assets · ZK proofs · native &amp; EVM wallets</div>
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="pill">{DEPLOYMENT.network}</span>
          {wallet ? (
            <span className="pill" title={wallet.kind === "native" ? wallet.account : wallet.address}>
              {wallet.kind === "native" ? `Portaldot · ${wallet.label.length > 20 ? short(wallet.label) : wallet.label}` : `EVM · ${short(wallet.address)}`}
              {balance && ` · ${Number(balance).toFixed(2)} tPOT`}
            </span>
          ) : (
            <>
              <button className="primary" onClick={pickNative}>
                Connect Portaldot Extension
              </button>
              <button className="ghost" onClick={pickEvm}>
                EVM wallet
              </button>
            </>
          )}
        </div>
      </header>

      {connectErr && (
        <div className="status err">
          {connectErr}{" "}
          {/Portaldot Extension/.test(connectErr) && (
            <a href={PORTALDOT_EXTENSION_URL} target="_blank" rel="noreferrer">
              Install it
            </a>
          )}
        </div>
      )}

      {nativeAccounts && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Choose an account</h2>
          <p className="hint">Your 5… account calls Umbra's contracts directly — no EVM wallet or 0x key needed.</p>
          {nativeAccounts.map((a) => (
            <button
              key={a.address}
              className="ghost"
              style={{ display: "block", width: "100%", textAlign: "left", marginTop: 6 }}
              onClick={() => chooseNative(a)}
            >
              <b>{a.name || "account"}</b> <span className="mono">{short(a.address)}</span> <span className="pill">{a.source}</span>
            </button>
          ))}
        </div>
      )}

      {!configured && !(wallet?.kind === "native") && (
        <div className="status info">
          No pools deployed for this network yet. Connect the Portaldot Extension to deploy Umbra from your account, or run{" "}
          <span className="mono">make deploy</span>.
        </div>
      )}

      {wallet?.kind === "native" && (showDeploy || !configured) && <DeployPanel wallet={wallet} />}
      {wallet?.kind === "native" && configured && !showDeploy && (
        <div style={{ textAlign: "right", marginBottom: 8 }}>
          <button className="ghost" onClick={() => setShowDeploy(true)}>
            Deploy another set…
          </button>
        </div>
      )}

      {wallet && asset && !showDeploy && (
        <>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div className="denoms">
              {assetList.map((a) => (
                <div key={a.symbol} className={`chip ${a.symbol === assetSym ? "active" : ""}`} onClick={() => setAssetSym(a.symbol)}>
                  {a.symbol}
                  {a.assetId !== null && <span style={{ opacity: 0.6 }}> #{a.assetId}</span>}
                </div>
              ))}
            </div>
            <div className="denoms">
              {denoms.map((d) => (
                <div key={d} className={`chip ${d === denom ? "active" : ""}`} onClick={() => setDenom(d)}>
                  {d} {asset.symbol}
                </div>
              ))}
            </div>
          </div>

          <div className="tabs">
            {(["deposit", "withdraw", "auditor"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "auditor" ? "Viewing key / Audit" : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
            {wallet.kind === "native" && viewingKey && (
              <button
                className="ghost"
                onClick={() => navigator.clipboard.writeText(exportViewingKey(viewingKey))}
                title="Stored only in this browser — back it up"
              >
                Export viewing key
              </button>
            )}
            {wallet.kind === "native" && (
              <button
                className="ghost"
                onClick={() => {
                  const v = prompt("Paste a previously exported viewing key (umbra-vk-…)");
                  if (v) setViewingKey(restoreViewingKey(wallet, v));
                }}
              >
                Restore viewing key
              </button>
            )}
            {wallet.kind === "evm" && !viewingKey && (
              <button className="ghost" onClick={async () => setViewingKey(await getViewingKey(wallet))}>
                Derive viewing key
              </button>
            )}
          </div>

          {client && tab === "deposit" && (
            <DepositPanel
              asset={asset}
              denomLabel={denom}
              denomWei={ethers.parseUnits(denom, asset.decimals)}
              viewingKey={viewingKey}
              deposit={deposit}
              wallet={wallet}
            />
          )}
          {client && tab === "withdraw" && <WithdrawPanel client={client} wallet={wallet} asset={asset} relayerUrl={RELAYER_URL} />}
          {client && tab === "auditor" && (
            <AuditorPanel client={client} myViewingKey={viewingKey} denomLabel={denom} decimals={asset.decimals} symbol={asset.symbol} />
          )}
        </>
      )}

      <div className="footer">
        Umbra · Portaldot V3 · EVM contracts called natively through pallet-revive · ZK verified on-chain or in WASM.
        <br />
        tPOT amounts use 18-decimal EVM units (native POT is 14-dec, scaled ×10⁴). Each withdrawal locks a ~3.84 tPOT storage
        slot on Portaldot, covered by the relayer fee.
      </div>
    </div>
  );
}
