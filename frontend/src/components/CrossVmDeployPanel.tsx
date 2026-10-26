import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  deployNative,
  dryRunInstantiate,
  deployCoprocessor,
  dryRunCoprocessorInstantiate,
  encodeCoprocessorNew,
  wasmCodeHash,
  evmAddressOf,
  BRIDGE_ABI,
  type Bytecodes,
  type CoprocessorArtifact,
} from "@umbra/sdk";
import artifacts from "@umbra/artifacts/contracts.json";
import coprocessorArtifact from "@umbra/artifacts/coprocessor.json";
import manifest from "@umbra/artifacts/MANIFEST.json";
import { DEPLOYMENT, NATIVE, getApi, readProvider, blockLink, short } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

const CODE = (artifacts as any).contracts as Bytecodes;
const ART = coprocessorArtifact as CoprocessorArtifact;
const DENOM = "10"; // tPOT; small enough to demo repeatedly
const LEVELS = 20;
const abi = ethers.AbiCoder.defaultAbiCoder();
const tpot = (p: bigint) => (Number(p) / 1e14).toLocaleString(undefined, { maximumFractionDigits: 2 });
const POOL_READ_ABI = [
  "function verifier() view returns (address)",
  "function hasher() view returns (address)",
  "function denomination() view returns (uint256)",
  "function token() view returns (address)",
  "function levels() view returns (uint32)",
];

type StepId = "coprocessor" | "bridge" | "pool";
type Progress = Partial<Record<StepId, { address: string; blockHash: string; block: number; codeHash: string }>>;
const STEPS: { id: StepId; label: string; vm: "WASM" | "EVM" }[] = [
  { id: "coprocessor", label: "Groth16 coprocessor (ink!, withdraw circuit key)", vm: "WASM" },
  { id: "bridge", label: "Coprocessor bridge (the pool's verifier)", vm: "EVM" },
  { id: "pool", label: `${DENOM} ${NATIVE} pool verified through the bridge`, vm: "EVM" },
];

function reviveCodeHash(info: any): string | null {
  if (!info?.isSome) return null;
  const kind = info.unwrap().accountType;
  return kind?.isContract ? kind.asContract.codeHash.toString() : null;
}

interface Props {
  wallet: Extract<Wallet, { kind: "native" }>;
}

/**
 * Deploy WASM-verified withdrawals from a native Portaldot account: the ink! coprocessor via
 * `contracts.instantiateWithCode`, then the EVM bridge and a pool that trusts it via
 * `revive.instantiateWithCode` — every step signed in the Portaldot Extension, priced by a
 * live dry-run, and resumable without redeploying finished steps.
 */
export default function CrossVmDeployPanel({ wallet }: Props) {
  const params = new URLSearchParams(location.search);
  const attestorParam = params.get("attestor");
  const poseidon: string = DEPLOYMENT.contracts.poseidon;
  const [attestor, setAttestor] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [verified, setVerified] = useState<StepId[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [price, setPrice] = useState<{ deposits: Record<StepId, bigint>; fees: bigint; need: bigint } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [deploymentJson, setDeploymentJson] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (attestorParam) {
        if (!ethers.isAddress(attestorParam)) throw new Error("The attestor link parameter is not a 0x address.");
        setAttestor(ethers.getAddress(attestorParam));
      } else {
        setAttestor(await evmAddressOf(await getApi(), wallet.account)); // you attest from this extension account
      }
    })().catch((e) => setStatus({ t: "err", m: e.message }));
  }, [wallet.account, attestorParam]);

  const storeKey = useMemo(
    () => attestor && `umbra-crossvm:v1:${DEPLOYMENT.chainId}:${wallet.account}:${manifest.files["sdk/artifacts/coprocessor.json"]}:${manifest.files["sdk/artifacts/contracts.json"]}:${attestor}:${poseidon}`,
    [attestor, wallet.account, poseidon]
  );
  useEffect(() => {
    if (!storeKey) return;
    try {
      setProgress(JSON.parse(localStorage.getItem(storeKey) || "{}"));
    } catch {
      setProgress({});
    }
    setVerified([]);
    setPrice(null);
  }, [storeKey]);
  useEffect(() => {
    (async () => setBalance(((await (await getApi()).query.system.account(wallet.account)) as any).data.free.toBigInt()))().catch(() => {});
  }, [wallet.account, busy]);

  const save = (p: Progress) => {
    setProgress(p);
    try {
      if (storeKey) localStorage.setItem(storeKey, JSON.stringify(p));
    } catch {
      /* resume won't survive a reload, but deployment still works */
    }
  };

  const bridgeInit = (att: string) => ethers.concat([CODE.UmbraCoprocessorBridge, abi.encode(["address", "address"], [ethers.ZeroAddress, att])]);
  const poolInit = (verifier: string) =>
    ethers.concat([CODE.UmbraPool, abi.encode(["address", "address", "uint256", "uint32"], [verifier, poseidon, ethers.parseUnits(DENOM, 18), LEVELS])]);

  /** Re-check every saved step against the chain before relying on it. */
  async function validate(saved: Progress): Promise<StepId[]> {
    const api = await getApi();
    const ok: StepId[] = [];
    if (saved.coprocessor) {
      if ((await wasmCodeHash(api, saved.coprocessor.address)) !== ART.codeHash) throw new Error("The saved coprocessor does not run the pinned WASM code. Deployment is paused.");
      ok.push("coprocessor");
    }
    if (saved.bridge) {
      const hash = reviveCodeHash(await api.query.revive.accountInfoOf(saved.bridge.address));
      const b = new ethers.Contract(saved.bridge.address, BRIDGE_ABI, readProvider);
      const [att, cop] = await Promise.all([b.attestor(), b.coprocessor()]);
      if (!hash || hash.toLowerCase() !== saved.bridge.codeHash.toLowerCase() || ethers.getAddress(att) !== attestor || cop !== ethers.ZeroAddress) {
        throw new Error("The saved bridge has different code or a different attestor. Deployment is paused.");
      }
      ok.push("bridge");
    }
    if (saved.pool) {
      if (!saved.bridge) throw new Error("A pool is saved without its bridge. Deployment is paused.");
      const hash = reviveCodeHash(await api.query.revive.accountInfoOf(saved.pool.address));
      const p = new ethers.Contract(saved.pool.address, POOL_READ_ABI, readProvider);
      const [verifier, hasher, denomination, token, levels] = await Promise.all([p.verifier(), p.hasher(), p.denomination(), p.token(), p.levels()]);
      if (
        !hash || hash.toLowerCase() !== saved.pool.codeHash.toLowerCase() ||
        ethers.getAddress(verifier) !== ethers.getAddress(saved.bridge.address) || ethers.getAddress(hasher) !== ethers.getAddress(poseidon) ||
        BigInt(denomination) !== ethers.parseUnits(DENOM, 18) || token !== ethers.ZeroAddress || Number(levels) !== LEVELS
      ) {
        throw new Error("The saved pool is not wired to the saved bridge and hasher. Deployment is paused.");
      }
      ok.push("pool");
    }
    return ok;
  }

  async function checkCost() {
    if (!attestor) return;
    setStatus({ t: "info", m: "Pricing each step with a live dry-run (nothing is signed)…" });
    setPrice(null);
    try {
      const api = await getApi();
      if (!reviveCodeHash(await api.query.revive.accountInfoOf(poseidon))) throw new Error("The configured Poseidon hasher is not on this chain.");
      const done = await validate(progress);
      setVerified(done);
      // Price from the richest account so the amount shown is exact even when this one is short.
      const entries = await api.query.system.account.entries();
      const rich = entries.sort((a: any, b: any) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();
      const deposits = { coprocessor: 0n, bridge: 0n, pool: 0n } as Record<StepId, bigint>;
      let fees = 0n;
      if (!done.includes("coprocessor")) {
        const dr = await dryRunCoprocessorInstantiate(api, rich, ART);
        if (!dr.ok) throw new Error(`The coprocessor would not deploy: ${dr.error ?? "constructor reverted"}`);
        deposits.coprocessor = dr.deposit;
        const tx = api.tx.contracts.instantiateWithCode(0, dr.weight, dr.deposit, ART.wasm, encodeCoprocessorNew(api, ART), "0x");
        fees += (await tx.paymentInfo(wallet.account)).partialFee.toBigInt();
      }
      const evmSteps: [StepId, string][] = [];
      if (!done.includes("bridge")) evmSteps.push(["bridge", bridgeInit(attestor)]);
      // Before the bridge exists, price the pool against the deployed verifier (same constructor work).
      if (!done.includes("pool")) evmSteps.push(["pool", poolInit(progress.bridge?.address ?? DEPLOYMENT.contracts.withdrawVerifier)]);
      for (const [id, init] of evmSteps) {
        const dr = await dryRunInstantiate(api, rich, init);
        if (!dr.ok) throw new Error(`The ${id} would not deploy: ${dr.error}`);
        deposits[id] = dr.deposit;
        const tx = api.tx.revive.instantiateWithCode(0, dr.weight, dr.deposit, init, "0x", null);
        fees += (await tx.paymentInfo(wallet.account)).partialFee.toBigInt();
      }
      const need = deposits.coprocessor + deposits.bridge + deposits.pool + fees;
      setPrice({ deposits, fees, need });
      const free = ((await api.query.system.account(wallet.account)) as any).data.free.toBigInt();
      setStatus(
        done.length === STEPS.length
          ? { t: "ok", m: "Every step is deployed and verified." }
          : free > need
            ? { t: "ok", m: `Affordable. ${done.length ? `${done.length} verified step(s) will be skipped. ` : ""}Each step is signed separately in your extension.` }
            : { t: "err", m: `This needs about ${tpot(need)} ${NATIVE}; the account holds ${tpot(free)}. Storage deposits stay locked with the contracts. Add ${tpot(need - free)} ${NATIVE} and check again.` }
      );
    } catch (e: any) {
      setVerified([]);
      setStatus({ t: "err", m: e.message });
    }
  }

  async function deploy() {
    if (!attestor || !price || (balance ?? 0n) <= price.need) return;
    setStatus(null);
    setDeploymentJson(null);
    let p: Progress = { ...progress };
    try {
      const api = await getApi();
      const done = await validate(p);
      for (const step of STEPS) {
        if (done.includes(step.id)) continue;
        setBusy(step.id);
        setStatus({ t: "info", m: `Sign "${step.label}" (${step.vm} VM) in the Portaldot Extension…` });
        let address: string, blockHash: string, codeHash: string | null;
        if (step.id === "coprocessor") {
          const r = await deployCoprocessor(api, wallet.account, { signer: wallet.signer }, ART);
          ({ address, blockHash } = r);
          codeHash = await wasmCodeHash(api, address);
        } else {
          const init = step.id === "bridge" ? bridgeInit(attestor) : poolInit(p.bridge!.address);
          const r = await deployNative(api, wallet.account, { signer: wallet.signer }, init);
          ({ address, blockHash } = r);
          codeHash = reviveCodeHash(await api.query.revive.accountInfoOf(address));
        }
        if (!codeHash) throw new Error(`Could not read the deployed code for ${step.label}`);
        const block = (await api.rpc.chain.getHeader(blockHash)).number.toNumber();
        p = { ...p, [step.id]: { address, blockHash, block, codeHash } };
        save(p);
        setVerified((ids) => [...ids, step.id]);
      }
      await validate(p);
      setBusy(null);
      setDeploymentJson(JSON.stringify(buildDeployment(p), null, 2));
      setStatus({ t: "ok", m: "WASM verification is deployed. Install the updated deployment.json below." });
    } catch (e: any) {
      setBusy(null);
      setStatus({ t: "err", m: `${e.message}. Deployment paused. If you approved a transaction, check its result before pressing Deploy again.` });
    }
  }

  function buildDeployment(p: Progress) {
    const { nativeSymbol: _derived, ...base } = DEPLOYMENT;
    return {
      ...base,
      crossVm: {
        coprocessor: p.coprocessor!.address,
        coprocessorCodeHash: p.coprocessor!.codeHash,
        bridge: p.bridge!.address,
        attestor,
        pools: { [DENOM]: p.pool!.address },
        deployBlock: Math.min(...STEPS.map((s) => p[s.id]!.block)),
        deployedAt: new Date().toISOString(),
      },
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

  const doneCount = verified.length;
  const canDeploy = !busy && !!attestor && !!price && balance !== null && balance > price.need && doneCount < STEPS.length;

  return (
    <div className="card deploy-card">
      <div className="deploy-title-row">
        <div><span className="eyebrow">CROSS-VM SETUP · {DEPLOYMENT.network}</span><h2>Verify proofs in the WASM VM</h2></div>
        <span className="deploy-count">{doneCount} of {STEPS.length} verified</span>
      </div>
      <div className="deploy-progress" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={doneCount} aria-label="Verified steps"><span style={{ width: `${(doneCount / STEPS.length) * 100}%` }} /></div>
      <p className="hint">
        The coprocessor runs the Groth16 pairing check in Portaldot's WASM VM (<span className="mono">pallet-contracts</span>). Each
        withdrawal from the new pool signs one batch: verify in WASM, then attest on the EVM bridge. If WASM rejects the proof, the
        attestation is rolled back with it.
      </p>

      <div className="deploy-account">
        <span className="eyebrow">ATTESTOR (TRUSTED)</span>
        <strong className="mono">{attestor ?? "…"}</strong>
        <span className="hint">
          {attestorParam ? "Set by the link." : `The EVM identity of ${short(wallet.account)}: only this account can attest withdrawals from the new pool.`} The bridge
          trusts this key to attest only proofs the WASM VM accepted.
        </span>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
        <span className="pill">Balance: {balance === null ? "…" : `${tpot(balance)} ${NATIVE}`}</span>
        {price && <span className="pill">Needs ≈ {tpot(price.need)} {NATIVE}</span>}
        <button onClick={checkCost} disabled={!!busy || !attestor}>Check live cost</button>
        <button className="primary" onClick={deploy} disabled={!canDeploy}>
          {busy ? "Deploying…" : doneCount ? `Deploy remaining ${STEPS.length - doneCount}` : "Deploy"}
        </button>
      </div>
      {status && <div className={`status ${status.t}`} role="status">{status.m}</div>}

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={progress[s.id] ? "done" : busy === s.id ? "active" : ""}>
            <span className="dot">{verified.includes(s.id) ? "✓" : i + 1}</span>
            <span className="pill">{s.vm}</span> {s.label}
            {price && !verified.includes(s.id) && <span className="hint"> · deposit {tpot(price.deposits[s.id])} {NATIVE}</span>}
            {verified.includes(s.id) && progress[s.id] && (
              <>
                {" — "}
                <span className="mono">{short(progress[s.id]!.address)}</span>{" "}
                <a href={blockLink(progress[s.id]!.blockHash)} target="_blank" rel="noreferrer">block ↗</a>
              </>
            )}
          </li>
        ))}
      </ol>
      {price && <p className="hint">Includes ≈ {tpot(price.fees)} {NATIVE} in transaction fees. The code-upload deposit dominates: pallet-contracts charges per byte of stored code.</p>}

      {deploymentJson && (
        <>
          <button className="primary" style={{ marginTop: 12 }} onClick={download}>Download deployment.json</button>
          <button className="ghost" style={{ marginTop: 12, marginLeft: 8 }} onClick={() => navigator.clipboard.writeText(deploymentJson)}>Copy deployment JSON</button>
          <p className="hint" style={{ marginTop: 8 }}>
            It keeps every existing address and adds a <span className="mono">crossVm</span> section. Save it as{" "}
            <span className="mono">frontend/src/config/deployment.json</span> and <span className="mono">deployments/testnet.json</span>, then reload.
          </p>
          <textarea readOnly value={deploymentJson} style={{ minHeight: 180 }} />
        </>
      )}
    </div>
  );
}
