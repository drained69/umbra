import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  planDeployment,
  deployNative,
  contractExists,
  estimateDeployment,
  evmAddressOf,
  assetErc20Address,
  type Bytecodes,
  type DeployConfig,
} from "@umbra/sdk";
import artifacts from "@umbra/artifacts/contracts.json";
import { DEPLOYMENT, getApi, blockLink, short } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

const CODE = (artifacts as any).contracts as Bytecodes;
const PUSD = { assetId: 7777, symbol: "pUSD", decimals: 6 };
const tpot = (p: bigint) => (Number(p) / 1e14).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Progress = Record<string, { address: string; blockHash: string; block?: number }>;

interface Props {
  wallet: Extract<Wallet, { kind: "native" }>;
}

/**
 * Deploy Umbra from a native Portaldot account: every contract is a
 * `revive.instantiateWithCode` signed in the Portaldot Extension. Prices come from a live
 * dry-run; progress is saved per step so an interrupted deployment resumes without
 * redeploying (and re-paying) finished contracts.
 */
export default function DeployPanel({ wallet }: Props) {
  const [opts, setOpts] = useState({ t100: true, t1000: false, p100: false, p1000: false, shielded: false });
  const cfg: DeployConfig = useMemo(
    () => ({
      nativeDenoms: [opts.t100 && "100", opts.t1000 && "1000"].filter(Boolean) as string[],
      token: opts.p100 || opts.p1000 ? { ...PUSD, denoms: [opts.p100 && "100", opts.p1000 && "1000"].filter(Boolean) as string[] } : undefined,
      shielded: opts.shielded,
    }),
    [opts]
  );
  const steps = useMemo(() => planDeployment(CODE, cfg), [cfg]);
  const storeKey = `umbra-deploy:${DEPLOYMENT.chainId}:${wallet.account}`;
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) || "{}");
    } catch {
      return {};
    }
  });
  const [balance, setBalance] = useState<bigint | null>(null);
  const [estimate, setEstimate] = useState<{ need: bigint; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [deploymentJson, setDeploymentJson] = useState<string | null>(null);

  const save = (p: Progress) => {
    setProgress(p);
    try {
      localStorage.setItem(storeKey, JSON.stringify(p));
    } catch {
      /* resume won't survive a reload, but deployment still works */
    }
  };

  useEffect(() => {
    (async () => {
      const api = await getApi();
      setBalance(((await api.query.system.account(wallet.account)) as any).data.free.toBigInt());
    })().catch(() => {});
  }, [wallet.account, busy]);

  async function price() {
    setStatus({ t: "info", m: "Pricing the deployment with a live dry-run (nothing is signed)…" });
    setEstimate(null);
    try {
      const api = await getApi();
      const entries = await api.query.system.account.entries();
      const rich = entries.sort((a: any, b: any) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();
      const e = await estimateDeployment(api, wallet.account, CODE, cfg, rich);
      // contracts already deployed in a previous run don't need paying for again
      const done = steps.filter((s) => progress[s.id]).length;
      setEstimate({ need: e.deposit + e.fee, ok: e.sufficientFunds });
      setStatus(
        e.sufficientFunds
          ? { t: "ok", m: `Affordable. ${done ? `${done} step(s) already deployed and will be skipped.` : ""}` }
          : { t: "err", m: `Not enough tPOT yet — ask the Portaldot faucet admin for more, then come back.` }
      );
    } catch (e: any) {
      setStatus({ t: "err", m: e.message });
    }
  }

  async function deploy() {
    setStatus(null);
    setDeploymentJson(null);
    const api = await getApi();
    const addr: Record<string, string> = Object.fromEntries(Object.entries(progress).map(([k, v]) => [k, v.address]));
    let p = { ...progress };
    try {
      for (const step of steps) {
        if (p[step.id] && (await contractExists(api, p[step.id].address))) continue; // resume
        setBusy(step.id);
        setStatus({ t: "info", m: `Sign "${step.label}" in the Portaldot Extension…` });
        const r = await deployNative(api, wallet.account, { signer: wallet.signer }, step.initcode(addr));
        const block = (await api.rpc.chain.getHeader(r.blockHash)).number.toNumber();
        addr[step.id] = r.address;
        p = { ...p, [step.id]: { address: r.address, blockHash: r.blockHash, block } };
        save(p);
      }
      setBusy(null);
      setDeploymentJson(JSON.stringify(await buildDeployment(p), null, 2));
      setStatus({ t: "ok", m: "Umbra is deployed. Download deployment.json below." });
    } catch (e: any) {
      setBusy(null);
      setStatus({ t: "err", m: `${e.message} — progress is saved; press Deploy again to resume.` });
    }
  }

  async function buildDeployment(p: Progress) {
    const api = await getApi();
    const firstBlock = Math.min(...Object.values(p).map((x) => x.block ?? Infinity));
    const pools: Record<string, string> = {};
    for (const d of cfg.nativeDenoms) pools[d] = p[`pool:tPOT:${d}`].address;
    const tokens: Record<string, any> = {};
    if (cfg.token) {
      const a: any = ((await api.query.assets.asset(cfg.token.assetId)) as any).unwrap();
      tokens[cfg.token.symbol] = {
        assetId: cfg.token.assetId,
        address: assetErc20Address(cfg.token.assetId),
        decimals: cfg.token.decimals,
        sufficient: a.isSufficient.isTrue,
        minBalance: a.minBalance.toString(),
        pools: Object.fromEntries(cfg.token.denoms.map((d) => [d, p[`pool:${cfg.token!.symbol}:${d}`].address])),
      };
    }
    return {
      network: DEPLOYMENT.network,
      chainId: DEPLOYMENT.chainId,
      rpc: DEPLOYMENT.rpc,
      decimals: 18,
      nativeDecimals: 14,
      substrateWs: DEPLOYMENT.substrateWs,
      deployBlock: Number.isFinite(firstBlock) ? firstBlock : 0,
      verifierMode: "onchain",
      treeLevels: 20,
      relayerFeeBps: 50,
      contracts: {
        poseidon: p.poseidon.address,
        withdrawVerifier: p.withdrawVerifier.address,
        transactionVerifier: p.transactionVerifier?.address ?? ethers.ZeroAddress,
        verifier: p.withdrawVerifier.address,
        factory: null,
        pools,
        tokens,
        shieldedPool: p.shieldedPool?.address ?? ethers.ZeroAddress,
      },
      deployedAt: new Date().toISOString(),
      deployer: { native: wallet.account, evm: await evmAddressOf(api, wallet.account) },
      deployedVia: "native (Portaldot Extension, revive.instantiateWithCode)",
    };
  }

  function download() {
    if (!deploymentJson) return;
    const url = URL.createObjectURL(new Blob([deploymentJson], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "deployment.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggle = (k: keyof typeof opts) => {
    setOpts({ ...opts, [k]: !opts[k] });
    setEstimate(null);
  };
  const doneCount = steps.filter((s) => progress[s.id]).length;

  return (
    <div className="card">
      <h2>Deploy Umbra from your Portaldot account</h2>
      <p className="hint">
        Each contract is deployed with <span className="mono">revive.instantiateWithCode</span>, signed in the Portaldot
        Extension by <span className="mono">{short(wallet.account)}</span> — no EVM wallet or private key. Storage deposits stay
        locked with the contracts.
      </p>

      <label>What to deploy</label>
      <div className="denoms">
        {(
          [
            ["t100", "100 tPOT pool"],
            ["t1000", "1000 tPOT pool"],
            ["p100", "100 pUSD pool"],
            ["p1000", "1000 pUSD pool"],
            ["shielded", "Join-split (private transfers)"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className={`chip ${opts[k] ? "active" : ""}`} onClick={() => toggle(k)}>
            {opts[k] ? "✓ " : ""}
            {label}
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
        <span className="pill">Balance: {balance === null ? "…" : `${tpot(balance)} tPOT`}</span>
        {estimate && (
          <span className="pill">
            Needs ≈ {tpot(estimate.need)} tPOT{balance !== null && estimate.need > balance && ` · short ${tpot(estimate.need - balance)}`}
          </span>
        )}
        <button onClick={price} disabled={!!busy || cfg.nativeDenoms.length + (cfg.token?.denoms.length ?? 0) === 0}>
          Price it (live dry-run)
        </button>
        <button className="primary" onClick={deploy} disabled={!!busy || !estimate?.ok}>
          {busy ? "Deploying…" : doneCount ? `Resume (${doneCount}/${steps.length} done)` : "Deploy"}
        </button>
      </div>

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={progress[s.id] ? "done" : busy === s.id ? "active" : ""}>
            <span className="dot">{progress[s.id] ? "✓" : i + 1}</span>
            {s.label}
            {progress[s.id] && (
              <>
                {" — "}
                <span className="mono">{short(progress[s.id].address)}</span>{" "}
                <a href={blockLink(progress[s.id].blockHash)} target="_blank" rel="noreferrer">
                  block ↗
                </a>
              </>
            )}
          </li>
        ))}
      </ol>

      {status && <div className={`status ${status.t}`}>{status.m}</div>}

      {deploymentJson && (
        <>
          <button className="primary" style={{ marginTop: 12 }} onClick={download}>
            Download deployment.json
          </button>
          <p className="hint" style={{ marginTop: 8 }}>
            Save it as <span className="mono">frontend/src/config/deployment.json</span> (the app) and{" "}
            <span className="mono">deployments/testnet.json</span> (the relayer), then reload.
          </p>
          <textarea readOnly value={deploymentJson} style={{ minHeight: 180 }} />
        </>
      )}
    </div>
  );
}
