import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  planDeployment,
  deployNative,
  estimateDeployment,
  evmAddressOf,
  assetErc20Address,
  type Bytecodes,
  type DeployConfig,
} from "@umbra/sdk";
import artifacts from "@umbra/artifacts/contracts.json";
import manifest from "@umbra/artifacts/MANIFEST.json";
import recovery from "../config/recovery.json";
import { DEPLOYMENT, NATIVE, getApi, readProvider, blockLink, short } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

const CODE = (artifacts as any).contracts as Bytecodes;
const PUSD = { assetId: 7777, symbol: "pUSD", decimals: 6 };
const tpot = (p: bigint) => (Number(p) / 1e14).toLocaleString(undefined, { maximumFractionDigits: 2 });

type Progress = Record<string, { address: string; blockHash: string; block?: number; codeHash: string }>;
function codeHashOf(info: any): string | null {
  if (!info?.isSome) return null;
  const kind = info.unwrap().accountType;
  return kind?.isContract ? kind.asContract.codeHash.toString() : null;
}
const CONTRACT_READ_ABI = [
  "function verifier() view returns (address)",
  "function hasher() view returns (address)",
  "function denomination() view returns (uint256)",
  "function token() view returns (address)",
  "function levels() view returns (uint32)",
];

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
  const params = new URLSearchParams(location.search);
  const fullPlan = params.has("all");
  const expectedAccount = params.get("account");
  const savedRecovery = fullPlan && wallet.account === recovery.account && DEPLOYMENT.network === recovery.network ? recovery.poseidon : null;
  const recoveryAddress = params.get("recoverPoseidon") ?? savedRecovery?.address ?? null;
  const recoveryBlock = params.get("recoverBlock") ?? savedRecovery?.blockHash ?? null;
  const accountMatches = !expectedAccount || wallet.account === expectedAccount;
  const [opts, setOpts] = useState({ t100: true, t1000: fullPlan, p100: fullPlan, p1000: fullPlan, shielded: fullPlan });
  const [pusdExists, setPusdExists] = useState<boolean | null>(null);
  const cfg: DeployConfig = useMemo(
    () => ({
      nativeDenoms: [opts.t100 && "100", opts.t1000 && "1000"].filter(Boolean) as string[],
      token: pusdExists && (opts.p100 || opts.p1000) ? { ...PUSD, denoms: [opts.p100 && "100", opts.p1000 && "1000"].filter(Boolean) as string[] } : undefined,
      shielded: opts.shielded,
    }),
    [opts, pusdExists]
  );
  const steps = useMemo(() => planDeployment(CODE, cfg), [cfg]);
  const planId = steps.map((s) => s.id).join(",");
  const storeKey = `umbra-deploy:v2:${DEPLOYMENT.chainId}:${wallet.account}:${manifest.files["sdk/artifacts/contracts.json"]}:${planId}`;
  const [progress, setProgress] = useState<Progress>({});
  const [verifiedIds, setVerifiedIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      setProgress(JSON.parse(localStorage.getItem(storeKey) || "{}"));
    } catch {
      setProgress({});
    }
    setVerifiedIds([]);
    setEstimate(null);
  }, [storeKey]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [estimate, setEstimate] = useState<{ need: bigint; ok: boolean; fullAffordable: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [deploymentJson, setDeploymentJson] = useState<string | null>(null);
  useEffect(() => {
    if (!recoveryAddress || !recoveryBlock || !accountMatches) return;
    let cancelled = false;
    (async () => {
      setBusy("recovering");
      setStatus({ t: "info", m: "Verifying the previously submitted Poseidon transaction on chain…" });
      const api = await getApi();
      const block = await api.rpc.chain.getBlock(recoveryBlock);
      const events: any[] = await api.query.system.events.at(recoveryBlock) as any;
      const index = block.block.extrinsics.findIndex((tx: any) =>
        tx.signer.toString() === wallet.account &&
        tx.method.section === "revive" &&
        tx.method.method === "instantiateWithCode" &&
        tx.method.args[3]?.toHex().toLowerCase() === CODE.Poseidon2.toLowerCase()
      );
      if (index < 0) throw new Error("Recovery block does not contain this account's Poseidon deployment.");
      const deployed = events.some((record: any) =>
        record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index &&
        record.event.section === "revive" && record.event.method === "Instantiated" &&
        record.event.data[1]?.toString().toLowerCase() === recoveryAddress.toLowerCase()
      );
      if (!deployed) throw new Error("Recovery address does not match the contract emitted by that transaction.");
      const hash = codeHashOf(await api.query.revive.accountInfoOf(recoveryAddress));
      if (!hash) throw new Error("The recovered Poseidon contract is no longer on chain.");
      const recovered = { address: ethers.getAddress(recoveryAddress), blockHash: recoveryBlock, block: block.block.header.number.toNumber(), codeHash: hash };
      if (cancelled) return;
      const saved: Progress = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (saved.poseidon && saved.poseidon.address.toLowerCase() !== recoveryAddress.toLowerCase()) {
        throw new Error("A different Poseidon deployment is already saved in this browser. Keep that deployment and remove the recovery link parameters.");
      }
      const next = { ...saved, poseidon: recovered };
      localStorage.setItem(storeKey, JSON.stringify(next));
      setProgress(next);
      setVerifiedIds(["poseidon"]);
      setEstimate(null);
      setStatus({ t: "ok", m: "Recovered the on-chain Poseidon contract. Check the live cost, then deploy the remaining contracts. Poseidon will be skipped." });
    })().catch((e: any) => {
      if (!cancelled) setStatus({ t: "err", m: `Could not recover the earlier transaction: ${e.message}. Do not retry deployment until it is checked.` });
    }).finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [recoveryAddress, recoveryBlock, accountMatches, wallet.account, storeKey]);
  // Portaldot assets differ per network (V3 Live currently has none) — only offer what exists
  useEffect(() => {
    (async () => {
      const api = await getApi();
      setPusdExists(((await api.query.assets.asset(PUSD.assetId)) as any).isSome);
    })().catch(() => setStatus({ t: "err", m: "Could not check asset #7777. Refresh the page before pricing or deploying." }));
  }, []);

  const save = (p: Progress) => {
    setProgress(p);
    try {
      localStorage.setItem(storeKey, JSON.stringify(p));
    } catch {
      /* resume won't survive a reload, but deployment still works */
    }
  };

  async function validateProgress(api: Awaited<ReturnType<typeof getApi>>, saved: Progress): Promise<string[]> {
    const verified: string[] = [];
    const addr: Record<string, string> = {};
    for (const step of steps) {
      const item = saved[step.id];
      if (!item) continue;
      const info: any = await api.query.revive.accountInfoOf(item.address);
      const hash = codeHashOf(info)?.toLowerCase();
      if (!hash || !item.codeHash || hash !== item.codeHash.toLowerCase()) {
        throw new Error(`Saved ${step.label} does not match the deployed code. Deployment is paused; do not sign another step.`);
      }
      if (step.id.startsWith("pool:") || step.id === "shieldedPool") {
        const c = new ethers.Contract(item.address, CONTRACT_READ_ABI, readProvider);
        const [verifier, hasher, levels] = await Promise.all([c.verifier(), c.hasher(), c.levels()]);
        const wantVerifier = step.id === "shieldedPool" ? addr.transactionVerifier : addr.withdrawVerifier;
        if (!wantVerifier || ethers.getAddress(verifier) !== ethers.getAddress(wantVerifier) || !addr.poseidon || ethers.getAddress(hasher) !== ethers.getAddress(addr.poseidon) || Number(levels) !== 20) {
          throw new Error(`Saved ${step.label} has the wrong verifier, hasher, or tree depth. Deployment is paused.`);
        }
        if (step.id.startsWith("pool:")) {
          const [, asset, amount] = step.id.split(":");
          const [denomination, token] = await Promise.all([c.denomination(), c.token()]);
          const wantToken = asset === "tPOT" ? ethers.ZeroAddress : assetErc20Address(PUSD.assetId);
          const wantAmount = ethers.parseUnits(amount, asset === "tPOT" ? 18 : PUSD.decimals);
          if (BigInt(denomination) !== wantAmount || ethers.getAddress(token) !== ethers.getAddress(wantToken)) {
            throw new Error(`Saved ${step.label} has the wrong asset or denomination. Deployment is paused.`);
          }
        }
      }
      addr[step.id] = item.address;
      verified.push(step.id);
    }
    return verified;
  }

  useEffect(() => {
    (async () => {
      const api = await getApi();
      setBalance(((await api.query.system.account(wallet.account)) as any).data.free.toBigInt());
    })().catch(() => {});
  }, [wallet.account, busy]);

  async function price() {
    if (!accountMatches) return setStatus({ t: "err", m: `Connect the requested account: ${expectedAccount}` });
    setStatus({ t: "info", m: "Pricing the deployment with a live dry-run (nothing is signed)…" });
    setEstimate(null);
    try {
      const api = await getApi();
      const verified = await validateProgress(api, progress);
      setVerifiedIds(verified);
      const entries = await api.query.system.account.entries();
      const rich = entries.sort((a: any, b: any) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();
      const e = await estimateDeployment(api, wallet.account, CODE, cfg, rich);
      const remaining = verified.length < steps.length;
      setEstimate({ need: e.deposit + e.fee, ok: e.sufficientFunds || verified.length > 0, fullAffordable: e.sufficientFunds });
      setStatus(
        e.sufficientFunds
          ? { t: "ok", m: `Full plan is affordable. ${verified.length ? `${verified.length} verified step(s) will be skipped.` : "Each step will be signed separately in your extension."}` }
          : verified.length > 0 && remaining
            ? { t: "info", m: `${verified.length} deployed step(s) verified. The full-plan estimate exceeds your current balance; remaining steps are checked individually before signing.` }
            : { t: "err", m: `This plan needs about ${tpot(e.deposit + e.fee)} ${NATIVE}; your balance is ${tpot(balance ?? 0n)} ${NATIVE}. Add funds to the signing account, then check the live cost again. Storage deposits remain locked in the deployed contracts.` }
      );
    } catch (e: any) {
      setVerifiedIds([]);
      setStatus({ t: "err", m: e.message });
    }
  }

  async function deploy() {
    if (!accountMatches || !estimate?.ok) return;
    setStatus(null);
    setDeploymentJson(null);
    let p = { ...progress };
    try {
      const api = await getApi();
      const verified = await validateProgress(api, progress);
      const addr: Record<string, string> = Object.fromEntries(verified.map((id) => [id, progress[id].address]));
      for (const step of steps) {
        if (verified.includes(step.id)) continue;
        setBusy(step.id);
        setStatus({ t: "info", m: `Sign "${step.label}" in the Portaldot Extension…` });
        const r = await deployNative(api, wallet.account, { signer: wallet.signer }, step.initcode(addr));
        const block = (await api.rpc.chain.getHeader(r.blockHash)).number.toNumber();
        const info: any = await api.query.revive.accountInfoOf(r.address);
        const hash = codeHashOf(info);
        if (!hash) throw new Error(`Could not verify deployed code for ${step.label}`);
        addr[step.id] = r.address;
        p = { ...p, [step.id]: { address: r.address, blockHash: r.blockHash, block, codeHash: hash } };
        save(p);
        setVerifiedIds((ids) => [...ids, step.id]);
      }
      await validateProgress(api, p);
      setBusy(null);
      setDeploymentJson(JSON.stringify(await buildDeployment(p), null, 2));
      setStatus({ t: "ok", m: "Umbra is deployed. Download deployment.json below." });
    } catch (e: any) {
      setBusy(null);
      setStatus({ t: "err", m: `${e.message}. Deployment paused. If you approved a wallet transaction, do not press Deploy again until its on-chain result is checked.` });
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
      rpc: DEPLOYMENT.rpc ?? null, // null on V3 Live: the app reads via ReviveProvider
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
    if (busy || Object.keys(progress).length) return;
    setOpts({ ...opts, [k]: !opts[k] });
    setEstimate(null);
  };
  const doneCount = verifiedIds.length;

  return (
    <div className="card deploy-card">
      <div className="deploy-title-row">
        <div><span className="eyebrow">CONTRACT SETUP · {DEPLOYMENT.network}</span><h2>Deploy Umbra contracts</h2></div>
        <span className="deploy-count">{doneCount} of {steps.length} verified</span>
      </div>
      <div className="deploy-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Verified contracts"><span style={{ width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%` }} /></div>
      <p className="hint">
        Each contract is deployed with <span className="mono">revive.instantiateWithCode</span>, signed in the Portaldot
        Extension by <span className="mono">{short(wallet.account)}</span> — no EVM wallet or private key. Storage deposits stay
        locked with the contracts.
      </p>

      <div className="deploy-account">
        <span className="eyebrow">SIGNING ACCOUNT</span>
        <strong className="mono">{wallet.account}</strong>
        <span className={accountMatches ? "account-check good" : "account-check bad"}>
          {accountMatches ? "✓ Account matches this deployment" : `Wrong account — connect ${expectedAccount}`}
        </span>
      </div>

      <div className="deploy-plan-heading">
        <div><span className="eyebrow">DEPLOYMENT PLAN</span><p className="hint">Select the pools and private transfer engine to deploy.</p></div>
        <button type="button" className="ghost" disabled={!!busy || pusdExists === null || Object.keys(progress).length > 0} onClick={() => { setOpts({ t100: true, t1000: true, p100: !!pusdExists, p1000: !!pusdExists, shielded: true }); setEstimate(null); }}>Select all</button>
      </div>

      <div className="denoms">
        {(
          [
            ["t100", `100 ${NATIVE} pool`],
            ["t1000", `1000 ${NATIVE} pool`],
            ["p100", "100 pUSD pool"],
            ["p1000", "1000 pUSD pool"],
            ["shielded", "Join-split (private transfers)"],
          ] as const
        )
          .filter(([k]) => !(k.startsWith("p") && pusdExists === false))
          .map(([k, label]) => (
          <button type="button" key={k} className={`chip ${opts[k] ? "active" : ""}`} disabled={!!busy || Object.keys(progress).length > 0} onClick={() => toggle(k)}>
            {opts[k] ? "✓ " : ""}
            {label}
          </button>
        ))}
      </div>
      {pusdExists === false && (
        <p className="hint" style={{ marginTop: 6 }}>
          pUSD (asset #7777) doesn't exist on {DEPLOYMENT.network}, so asset pools aren't offered here.
        </p>
      )}

      <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
        <span className="pill">Balance: {balance === null ? "…" : `${tpot(balance)} ${NATIVE}`}</span>
        {estimate && (
          <span className="pill">
            Needs ≈ {tpot(estimate.need)} {NATIVE}
            {!estimate.fullAffordable && balance !== null && estimate.need > balance && ` · short ${tpot(estimate.need - balance)}`}
          </span>
        )}
        <button onClick={price} disabled={!!busy || !accountMatches || pusdExists === null || cfg.nativeDenoms.length + (cfg.token?.denoms.length ?? 0) === 0}>
          Check live cost
        </button>
        <button className="primary" onClick={deploy} disabled={!!busy || !accountMatches || !estimate?.ok}>
          {busy ? "Deploying…" : doneCount ? `Deploy remaining ${steps.length - doneCount}` : "Deploy contracts"}
        </button>
      </div>
      {!estimate && !busy && accountMatches && <p className="hint deploy-guidance">Check the live cost to enable deployment. Your extension will ask you to approve each remaining contract.</p>}
      {status && <div className={`status ${status.t}`} role="status">{status.m}</div>}

      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={progress[s.id] ? "done" : busy === s.id ? "active" : ""}>
            <span className="dot">{verifiedIds.includes(s.id) ? "✓" : i + 1}</span>
            {s.label}
            {verifiedIds.includes(s.id) && progress[s.id] && (
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

      {deploymentJson && (
        <>
          <button className="primary" style={{ marginTop: 12 }} onClick={download}>
            Download deployment.json
          </button>
          <button className="ghost" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => navigator.clipboard.writeText(deploymentJson)}>
            Copy deployment JSON
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
