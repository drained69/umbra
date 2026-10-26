import { useState } from "react";
import { ethers } from "ethers";
import {
  UmbraPoolClient,
  parseNote,
  nullifierHash,
  resolveRecipient,
  buildReviveCall,
  sendNative,
  POOL_ABI,
  POOL_ERRORS_ABI,
  type Note,
  type WithdrawProof,
} from "@umbra/sdk";
import PrivacyVisualizer from "./PrivacyVisualizer";
import { DEPLOYMENT, format, getApi, short, blockLink, type AssetInfo } from "../lib/chain";
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

export default function WithdrawPanel({ client, wallet, asset, relayerUrl }: Props) {
  const [noteStr, setNoteStr] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [useRelayer, setUseRelayer] = useState(Boolean(relayerUrl));
  const [step, setStep] = useState(-1);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string; href?: string } | null>(null);
  const [proof, setProof] = useState<WithdrawProof | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [resolved, setResolved] = useState<string>("");

  async function run() {
    setStatus(null);
    setProof(null);
    try {
      setStep(0);
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

      setStep(3);
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
      setStep(4);
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
      setStep(-1);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Withdraw privately</h2>
        <p className="hint">
          A zero-knowledge proof shows the pool you own <i>some</i> unspent note — never which one.
        </p>
        <label>Note backup</label>
        <textarea value={noteStr} onChange={(e) => setNoteStr(e.target.value)} placeholder="umbra-v3-…" />
        <label>Recipient — a 0x address or a Portaldot 5… account</label>
        <input value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)} placeholder="0x… or 5…" />
        {asset.rules && !asset.rules.sufficient && (
          <p className="hint" style={{ marginTop: 6 }}>
            {asset.symbol} can only be received by accounts that already hold tPOT. For a brand-new address, withdraw a tPOT
            note to it first (also private), then this one.
          </p>
        )}
        {relayerUrl ? <label className="row" style={{ marginTop: 14 }}>
          <input type="checkbox" style={{ width: 18 }} checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} />
          <span style={{ color: "var(--ink)" }}>Gasless via relayer (recommended — keeps the recipient unlinked)</span>
        </label> : <p className="hint withdrawal-route">Withdrawals are signed by your connected wallet. A gasless relayer is not connected to this app yet.</p>}
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
        {status && (
          <div className={`status ${status.t}`}>
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
        <h2>What leaks?</h2>
        <p className="hint">Only a nullifier — unlinkable to any deposit.</p>
        {proof && note ? (
          <PrivacyVisualizer
            title="Withdrawal"
            publicRows={[
              { k: "nullifierHash", v: "0x" + nullifierHash(note).toString(16).slice(0, 22) + "…" },
              { k: "recipient", v: resolved },
              { k: "link to deposit", v: "NONE — the proof hides which leaf" },
            ]}
            privateRows={[
              { k: "which note", v: "hidden by ZK Merkle membership" },
              {
                k: "proof",
                v: DEPLOYMENT.verifierMode === "coprocessor" ? "Groth16 — verified in the WASM coprocessor" : "Groth16 — verified on-chain (BN254 precompiles)",
              },
            ]}
          />
        ) : (
          <p className="hint">Run a withdrawal to see what the chain can (and can't) observe.</p>
        )}
      </div>
    </div>
  );
}
