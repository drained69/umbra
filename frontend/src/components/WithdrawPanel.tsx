import { useState } from "react";
import { ethers } from "ethers";
import {
  UmbraPoolClient,
  parseNote,
  nullifierHash,
  resolveRecipient,
  buildReviveCall,
  sendNative,
  evmAddressOf,
  groth16Words,
  withdrawSignals,
  verifyInWasmAndAttest,
  POOL_ABI,
  POOL_ERRORS_ABI,
  type CoprocessorArtifact,
  type Note,
  type WithdrawProof,
} from "@umbra/sdk";
import PrivacyVisualizer from "./PrivacyVisualizer";
import { CROSS_VM, DEPLOYMENT, format, getApi, isCrossVmPool, short, blockLink, type AssetInfo } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

const ARTIFACTS = { wasm: "/zk/withdraw.wasm", zkey: "/zk/withdraw_final.zkey" };
const POOL = new ethers.Interface([...POOL_ABI, ...POOL_ERRORS_ABI]);

interface Props {
  client: UmbraPoolClient;
  wallet: Wallet;
  asset: AssetInfo;
  relayerUrl: string;
}

const STEPS = ["Check note & recipient", "Scan pool & build Merkle path", "Generate ZK proof", "Submit withdrawal"];
const CROSS_VM_STEPS = [...STEPS.slice(0, 3), "Verify in WASM VM + attest on EVM", "Submit withdrawal"];

export default function WithdrawPanel({ client, wallet, asset, relayerUrl }: Props) {
  // WASM-verified pool: the proof is checked by the ink! coprocessor before the pool accepts it.
  const crossVm = isCrossVmPool(client.address) ? CROSS_VM : null;
  const steps = crossVm ? CROSS_VM_STEPS : STEPS;
  const [noteStr, setNoteStr] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [useRelayer, setUseRelayer] = useState(Boolean(relayerUrl) && !crossVm);
  const [step, setStep] = useState(-1);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string; href?: string } | null>(null);
  const [wasmRef, setWasmRef] = useState<{ m: string; href?: string } | null>(null);
  const [proof, setProof] = useState<WithdrawProof | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [resolved, setResolved] = useState<string>("");

  async function run() {
    setStatus(null);
    setProof(null);
    setWasmRef(null);
    try {
      setStep(0);
      if (crossVm) {
        // Checked before proving: only the bridge's attestor can record the WASM verdict.
        if (wallet.kind !== "native") throw new Error("This pool's proofs are verified in Portaldot's WASM VM, which an EVM wallet can't call. Connect the Portaldot Extension.");
        const me = await evmAddressOf(await getApi(), wallet.account);
        if (me !== crossVm.attestor) throw new Error(`Only the bridge attestor (${short(crossVm.attestor)}) can attest withdrawals from this pool in this prototype.`);
      }
      const n = parseNote(noteStr);
      setNote(n);
      if (await client.isSpent(n)) throw new Error("this note was already spent");

      // 0x… or a Portaldot 5… address (resolved to its pallet-revive H160)
      let recipient: string;
      if (ethers.isAddress(recipientInput.trim())) {
        recipient = ethers.getAddress(recipientInput.trim());
      } else {
        const r = await resolveRecipient(await getApi(), recipientInput);
        if (!r.receivable) throw new Error(r.note);
        recipient = r.evmAddress;
      }
      setResolved(recipient);

      setStep(1);
      let relayerAddr = recipient;
      let fee = 0n;
      if (useRelayer) {
        const s = await fetch(`${relayerUrl}/status`).then((r) => r.json());
        if (Number(s.chainId) !== Number(DEPLOYMENT.chainId)) throw new Error("relayer is on a different network");
        const quoted = s.fees?.[ethers.getAddress(client.address)];
        if (quoted === undefined) throw new Error("relayer does not serve this pool");
        relayerAddr = s.relayer;
        fee = BigInt(quoted); // includes the Portaldot nullifier-slot floor
        setStatus({ t: "info", m: `Relayer fee: ${format(fee, asset.decimals)} ${asset.symbol} (covers gas + the ~3.84 tPOT storage slot it locks)` });
      }

      setStep(2);
      setStatus({ t: "info", m: "Generating the zero-knowledge proof in your browser…" });
      const p = await client.buildWithdraw(n, recipient, relayerAddr, fee, ARTIFACTS); // also checks the recipient can receive
      setProof(p);

      if (crossVm && wallet.kind === "native") {
        setStep(3);
        setStatus({ t: "info", m: "Sign one transaction: the WASM coprocessor checks the proof, then the EVM bridge records it. If WASM rejects the proof, neither happens." });
        const api = await getApi();
        const art = (await import("@umbra/artifacts/coprocessor.json")).default as CoprocessorArtifact;
        const words = groth16Words(p, withdrawSignals(p.root, p.nullifierHash, recipient, relayerAddr, fee));
        const att = await verifyInWasmAndAttest(api, wallet.account, { signer: wallet.signer }, { coprocessor: crossVm.coprocessor, bridge: crossVm.bridge, art }, words);
        setWasmRef(att.tx ? { m: `Verified in the WASM VM and attested in block ${short(att.tx.blockHash)}`, href: blockLink(att.tx.blockHash) } : { m: "This proof was already verified in the WASM VM and attested." });
      }

      setStep(steps.length - 1);
      if (useRelayer) {
        const res = await fetch(`${relayerUrl}/withdraw`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ poolAddress: client.address, a: p.a, b: p.b, c: p.c, root: p.root.toString(), nullifierHash: p.nullifierHash.toString(), recipient }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "relayer rejected");
        setStatus({ t: "ok", m: `Withdrawn via relayer — EVM tx ${short(j.txHash)}` });
      } else if (wallet.kind === "evm") {
        setStatus({ t: "info", m: "Confirm in your EVM wallet (you pay gas and the ~3.84 tPOT nullifier slot)." });
        const hash = await client.withdrawSelf(p, recipient, wallet.signer);
        setStatus({ t: "ok", m: `Withdrawn — EVM tx ${short(hash)}` });
      } else {
        setStatus({ t: "info", m: "Sign in the Portaldot Extension (you pay the fee and the ~3.84 tPOT nullifier slot)." });
        const api = await getApi();
        const data = POOL.encodeFunctionData("withdraw", [p.a, p.b, p.c, p.root, p.nullifierHash, recipient, recipient, 0, 0]);
        const call = await buildReviveCall(api, wallet.account, client.address, data, 0n, { abi: [...POOL_ABI, ...POOL_ERRORS_ABI] });
        const r = await sendNative(api, wallet.account, [call], { signer: wallet.signer });
        setStatus({ t: "ok", m: `Withdrawn in block ${short(r.blockHash)}`, href: blockLink(r.blockHash) });
      }
      setStep(steps.length);
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
      setStep(-1);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Withdraw a note</h2>
        <p className="hint">
          A zero-knowledge proof shows the pool you own <i>some</i> unspent note — never which one.
        </p>
        <label htmlFor="withdraw-note">Note backup</label>
        <textarea id="withdraw-note" value={noteStr} onChange={(e) => setNoteStr(e.target.value)} placeholder="umbra-v3-…" spellCheck={false} autoCapitalize="off" autoComplete="off" />
        <label htmlFor="withdraw-recipient">Recipient — a 0x address or a Portaldot 5… account</label>
        <input id="withdraw-recipient" value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)} placeholder="0x… or 5…" spellCheck={false} autoCapitalize="off" autoComplete="off" />
        {asset.rules && !asset.rules.sufficient && (
          <p className="hint" style={{ marginTop: 6 }}>
            {asset.symbol} can only be received by accounts that already hold tPOT. For a brand-new address, withdraw a tPOT
            note to it first (also private), then this one.
          </p>
        )}
        {crossVm ? <p className="hint withdrawal-route">This pool's proofs are verified in Portaldot's WASM VM. Your Portaldot Extension signs the verification and then the withdrawal, so your account is the visible sender. The bridge trusts its attestor ({short(crossVm.attestor)}).</p> : relayerUrl ? <label className="row" style={{ marginTop: 14 }}>
          <input type="checkbox" style={{ width: 18 }} checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} />
          <span style={{ color: "var(--ink)" }}>Use relayer (keeps your wallet off the withdrawal transaction)</span>
        </label> : <p className="hint withdrawal-route">Withdrawals are signed by your connected wallet. A gasless relayer is not connected to this app yet.</p>}
        <button className="primary" style={{ marginTop: 16 }} onClick={run} disabled={!noteStr.trim() || !recipientInput.trim() || (step >= 0 && step < steps.length)}>
          Withdraw
        </button>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className={step > i ? "done" : step === i ? "active" : ""}>
              <span className="dot">{step > i ? "✓" : i + 1}</span> {s}
            </li>
          ))}
        </ol>
        {wasmRef && (
          <div className="status ok" role="status">
            {wasmRef.m}{" "}
            {wasmRef.href && <a href={wasmRef.href} target="_blank" rel="noreferrer">view ↗</a>}
          </div>
        )}
        {status && (
          <div className={`status ${status.t}`} role={status.t === "err" ? "alert" : "status"}>
            {status.m}{" "}
            {status.href && (
              <a href={status.href} target="_blank" rel="noreferrer">
                view ↗
              </a>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>What others can see</h2>
        <p className="hint">The nullifier, recipient, fixed pool size, and transaction sender are public. A small pool or timing can reduce privacy.</p>
        {proof && note ? (
          <PrivacyVisualizer
            title="Withdrawal"
            publicRows={[
              { k: "nullifierHash", v: "0x" + nullifierHash(note).toString(16).slice(0, 22) + "…" },
              { k: "recipient", v: resolved },
              { k: "pool amount", v: `fixed ${asset.symbol} denomination` },
              { k: "link to deposit", v: "not disclosed by the proof; metadata can still narrow candidates" },
              { k: "verification", v: crossVm ? "Groth16 proof checked by the WASM coprocessor, then attested on the EVM bridge" : "Groth16 proof checked on-chain in the EVM" },
            ]}
            privateRows={[
              { k: "which note", v: "hidden by ZK Merkle membership" },
              { k: "note secret", v: "stays in your local backup" },
            ]}
          />
        ) : (
          <p className="hint">Start a withdrawal to see exactly what becomes public.</p>
        )}
      </div>
    </div>
  );
}
