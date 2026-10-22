import { useState } from "react";
import { ethers } from "ethers";
import {
  UmbraPoolClient,
  parseNote,
  nullifierHash,
  type Note,
  type WithdrawProof,
} from "@umbra/sdk";
import PrivacyVisualizer from "./PrivacyVisualizer";

const ARTIFACTS = { wasm: "/zk/withdraw.wasm", zkey: "/zk/withdraw_final.zkey" };

interface Props {
  client: UmbraPoolClient;
  signer: ethers.Signer;
  relayerUrl: string;
}

const STEPS = ["Parse note", "Scan pool & build Merkle path", "Generate ZK proof", "Submit withdrawal"];

export default function WithdrawPanel({ client, signer, relayerUrl }: Props) {
  const [noteStr, setNoteStr] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
  const [step, setStep] = useState(-1);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [proof, setProof] = useState<WithdrawProof | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  async function run() {
    setStatus(null);
    setProof(null);
    try {
      setStep(0);
      const n = parseNote(noteStr);
      setNote(n);
      if (!ethers.isAddress(recipient)) throw new Error("enter a valid recipient address");
      if (await client.isSpent(n)) throw new Error("this note was already spent");

      setStep(1);
      // relayer address is the proof-bound relayer; for self-withdraw it's the recipient.
      const relayerAddr = useRelayer ? await getRelayerAddress(relayerUrl) : recipient;
      const fee = useRelayer ? await quoteFee(client, relayerUrl) : 0n;

      setStep(2);
      setStatus({ t: "info", m: "Generating zero-knowledge proof in your browser… (a few seconds)" });
      const p = await client.buildWithdraw(n, recipient, relayerAddr, fee, ARTIFACTS);
      setProof(p);

      setStep(3);
      if (useRelayer) {
        setStatus({ t: "info", m: "Sending proof to relayer — it pays gas, recipient stays pristine." });
        const res = await fetch(`${relayerUrl}/withdraw`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            poolAddress: client.address,
            a: p.a,
            b: p.b,
            c: p.c,
            root: p.root.toString(),
            nullifierHash: p.nullifierHash.toString(),
            recipient,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "relayer rejected");
        setStatus({ t: "ok", m: `Withdrawn via relayer. tx: ${j.txHash}` });
      } else {
        setStatus({ t: "info", m: "Submitting withdrawal — approve in MetaMask." });
        const hash = await client.withdrawSelf(p, recipient, signer);
        setStatus({ t: "ok", m: `Withdrawn. tx: ${hash}` });
      }
      setStep(4);
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Withdraw privately</h2>
        <p className="hint">
          Paste your note and a fresh recipient address. A ZK proof shows the pool you own{" "}
          <i>some</i> unspent note — never which one.
        </p>
        <label>Note backup</label>
        <textarea value={noteStr} onChange={(e) => setNoteStr(e.target.value)} placeholder="umbra-v3-…" />
        <label>Recipient (use a brand-new address for full unlinkability)</label>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" />
        <label className="row" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            style={{ width: 18 }}
            checked={useRelayer}
            onChange={(e) => setUseRelayer(e.target.checked)}
          />
          <span style={{ color: "var(--ink)" }}>
            Gasless via relayer (recipient never needs gas — recommended)
          </span>
        </label>
        <button className="primary" style={{ marginTop: 16 }} onClick={run} disabled={step >= 0 && step < 4}>
          Withdraw
        </button>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={i} className={step > i ? "done" : step === i ? "active" : ""}>
              <span className="dot">{step > i ? "✓" : i + 1}</span> {s}
            </li>
          ))}
        </ol>
        {status && <div className={`status ${status.t}`}>{status.m}</div>}
      </div>

      <div className="card">
        <h2>What leaks?</h2>
        <p className="hint">Only a nullifier — unlinkable to any deposit.</p>
        {proof && note ? (
          <PrivacyVisualizer
            title="Withdrawal"
            publicRows={[
              { k: "nullifierHash", v: "0x" + nullifierHash(note).toString(16).slice(0, 22) + "…" },
              { k: "recipient", v: recipient },
              { k: "link to deposit", v: "NONE — proof hides which leaf" },
            ]}
            privateRows={[
              { k: "which note", v: "hidden by ZK Merkle membership" },
              { k: "proof", v: "Groth16 — verified in WASM coprocessor" },
            ]}
          />
        ) : (
          <p className="hint">Run a withdrawal to see what the chain can (and can't) observe.</p>
        )}
      </div>
    </div>
  );
}

async function getRelayerAddress(url: string): Promise<string> {
  const r = await fetch(`${url}/status`);
  const j = await r.json();
  return j.relayer;
}
async function quoteFee(client: UmbraPoolClient, url: string): Promise<bigint> {
  const [denom, status] = await Promise.all([client.denomination(), fetch(`${url}/status`).then((r) => r.json())]);
  return (denom * BigInt(status.feeBps)) / 10000n;
}
