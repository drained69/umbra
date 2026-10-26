import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { assetErc20Address, deployNative, dryRunInstantiate, planMultiAssetDeployment, type Bytecodes } from "@umbra/sdk";
import artifacts from "@umbra/artifacts/contracts.json";
import { DEPLOYMENT, NATIVE, blockLink, getApi, short } from "./lib/chain";
import { connectNative, listNativeAccounts, type NativeAccount, type Wallet } from "./lib/wallet";
import CopyButton from "./components/CopyButton";
import "./styles.css";

/**
 * Operator page (not linked from the app): deploy the multi-asset private pool from a native
 * Portaldot account, signed in the Portaldot Extension. Each step is priced by a live dry-run
 * first; finished steps are saved in this browser so an interrupted deploy resumes.
 */
const CODE = (artifacts as any).contracts as Bytecodes;
const PUSD = (DEPLOYMENT.contracts.tokens as any)?.pUSD;
const tpot = (p: bigint) => (Number(p) / 1e14).toLocaleString(undefined, { maximumFractionDigits: 2 });
type Progress = Record<string, { address: string; blockHash: string }>;
// Deposits measured on testnet 2026-10-26 (sdk/test/multiasset_deploy_live.ts), shown when the
// connected account can't afford a dry-run (the runtime then reports no deposit).
const MEASURED = [27_145_200_000_000_000n, 75_026_900_000_000_000n];

function DeployPage() {
  const [accounts, setAccounts] = useState<NativeAccount[] | null>(null);
  const [wallet, setWallet] = useState<Extract<Wallet, { kind: "native" }> | null>(null);
  const [estimate, setEstimate] = useState<{ deposits: bigint[]; free: bigint; affordable: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const storeKey = wallet ? `umbra-deploy-ma:v1:${DEPLOYMENT.chainId}:${wallet.account}` : null;
  const [progress, setProgress] = useState<Progress>({});
  const steps = useMemo(() => planMultiAssetDeployment(CODE, { poseidon: DEPLOYMENT.contracts.poseidon, tokens: PUSD ? [assetErc20Address(PUSD.assetId)] : [] }), []);

  useEffect(() => {
    if (!storeKey) return;
    try { setProgress(JSON.parse(localStorage.getItem(storeKey) || "{}")); } catch { setProgress({}); }
  }, [storeKey]);

  useEffect(() => {
    if (!wallet) return;
    let stop = false;
    (async () => {
      const api = await getApi();
      const addr: Record<string, string> = {};
      const deposits: bigint[] = [];
      let affordable = true;
      for (const [i, s] of steps.entries()) {
        const dr = await dryRunInstantiate(api, wallet.account, s.initcode(addr));
        if (!dr.ok) affordable = false;
        deposits.push(dr.ok ? dr.deposit : MEASURED[i]);
        addr[s.id] = dr.address ?? "0x0000000000000000000000000000000000000001";
      }
      const acc: any = await api.query.system.account(wallet.account);
      if (!stop) setEstimate({ deposits, free: acc.data.free.toBigInt(), affordable });
    })().catch((e) => !stop && setError(e?.message || String(e)));
    return () => { stop = true; };
  }, [wallet]);

  async function connect() {
    setError(null);
    try { setAccounts((await listNativeAccounts()).accounts); } catch (e: any) { setError(e?.message || String(e)); }
  }

  async function deploy() {
    if (!wallet || !storeKey) return;
    setBusy(true);
    setError(null);
    try {
      const api = await getApi();
      const done: Progress = { ...progress };
      const addr = Object.fromEntries(Object.entries(done).map(([k, v]) => [k, v.address]));
      for (const s of steps) {
        if (done[s.id]) continue;
        const r = await deployNative(api, wallet.account, { signer: wallet.signer }, s.initcode(addr));
        done[s.id] = { address: r.address, blockHash: r.blockHash };
        addr[s.id] = r.address;
        localStorage.setItem(storeKey, JSON.stringify(done));
        setProgress({ ...done });
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const total = estimate ? estimate.deposits.reduce((a, b) => a + b, 0n) : 0n;
  const finished = steps.every((s) => progress[s.id]);
  const config = finished && {
    address: progress.multiAssetPool.address,
    verifier: progress.multiAssetVerifier.address,
    assets: [{ id: 0, symbol: NATIVE, address: null, decimals: 18 }].concat(PUSD ? [{ id: 1, symbol: "pUSD", address: PUSD.address, assetId: PUSD.assetId, decimals: PUSD.decimals } as any] : []),
  };

  return (
    <main className="content-wrap" style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <div className="card">
        <h2>Deploy the multi-asset private pool</h2>
        <p className="hint">Adds one private balance for {NATIVE} and pUSD, with private swaps, to {DEPLOYMENT.network}. It reuses the deployed Poseidon hasher {short(DEPLOYMENT.contracts.poseidon)}. You sign {steps.length} transactions in the Portaldot Extension.</p>
        {!wallet && (accounts === null
          ? <button className="primary" onClick={connect}>Connect Portaldot Extension</button>
          : accounts.length === 0 ? <p className="hint">No accounts found in the extension.</p>
          : <div className="denoms">{accounts.map((a) => <button key={a.address} className="chip" onClick={async () => setWallet((await connectNative(a)) as any)}>{a.name || short(a.address)}</button>)}</div>)}
        {wallet && <>
          <p className="hint">Account {short(wallet.account)}</p>
          <ul className="list">
            {steps.map((s, i) => <li key={s.id}><span className="grow">{s.label}</span>{progress[s.id]
              ? <a href={blockLink(progress[s.id].blockHash)} target="_blank" rel="noreferrer">{short(progress[s.id].address)} ↗</a>
              : <small>{estimate ? `${tpot(estimate.deposits[i])} ${NATIVE} deposit` : "pricing…"}</small>}</li>)}
          </ul>
          {estimate && !finished && <p className={estimate.free < total || !estimate.affordable ? "status err" : "hint"}>Total storage deposit ≈ {tpot(total)} {NATIVE} plus fees. This account has {tpot(estimate.free)} {NATIVE}{estimate.free < total ? `: about ${tpot(total - estimate.free)} ${NATIVE} short` : ""}.</p>}
          {!finished && <button className="primary" disabled={busy || !estimate || !estimate.affordable || estimate.free < total} onClick={deploy}>{busy ? "Deploying…" : Object.keys(progress).length ? "Resume deployment" : "Deploy"}</button>}
          {config && <div className="share-box"><div>
            <strong>Deployed. Add this to the deployment config as contracts.multiAssetPool:</strong>
            <pre className="mono wrap" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(config, null, 2)}</pre>
            <CopyButton className="primary" value={JSON.stringify(config, null, 2)}>Copy config</CopyButton>
          </div></div>}
        </>}
        {error && <div className="status err" role="alert">{error}</div>}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><DeployPage /></React.StrictMode>);
