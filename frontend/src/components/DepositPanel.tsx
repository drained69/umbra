import { useState } from "react";
import {
  UmbraPoolClient,
  createNote,
  commitment,
  nullifierHash,
  serializeNote,
  encryptMemo,
  type Note,
} from "@umbra/sdk";
import PrivacyVisualizer from "./PrivacyVisualizer";

interface Props {
  client: UmbraPoolClient;
  denomLabel: string;
  denomWei: bigint;
  viewingKey: Uint8Array | null;
}

export default function DepositPanel({ client, denomLabel, denomWei, viewingKey }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  function gen() {
    setNote(createNote(denomWei));
    setTxHash(null);
    setStatus({ t: "info", m: "Note generated locally. Back it up — it is the ONLY way to withdraw." });
  }

  async function deposit() {
    if (!note) return;
    setBusy(true);
    setStatus({ t: "info", m: "Depositing… approve in MetaMask." });
    try {
      let memo = new Uint8Array();
      if (viewingKey) {
        // Read-only memo: NO spend secrets (audit C-01). The note backup is the only
        // thing that can withdraw; the viewing key only reveals history.
        memo = encryptMemo(viewingKey, {
          action: "deposit",
          denomination: denomWei.toString(),
          commitment: commitment(note).toString(16),
          nullifierHash: nullifierHash(note).toString(16),
          ts: Date.now(),
        });
      }
      const hash = await client.deposit(note, memo);
      setTxHash(hash);
      setStatus({ t: "ok", m: `Shielded ${denomLabel} tPOT. Deposit is now indistinguishable in the pool.` });
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Shield {denomLabel} tPOT</h2>
        <p className="hint">
          A random note is created in your browser. Only its <b>commitment</b> goes on-chain — the
          amount link to you is severed the moment it joins the pool.
        </p>
        <button onClick={gen}>① Generate note</button>
        {note && (
          <>
            <div className="note-box">{serializeNote(note)}</div>
            <button
              className="ghost"
              style={{ marginTop: 8 }}
              onClick={() => navigator.clipboard.writeText(serializeNote(note))}
            >
              Copy backup
            </button>
            <button className="primary" style={{ marginTop: 8, marginLeft: 8 }} onClick={deposit} disabled={busy}>
              {busy ? "Depositing…" : `② Deposit ${denomLabel} tPOT`}
            </button>
          </>
        )}
        {status && <div className={`status ${status.t}`}>{status.m}</div>}
        {txHash && (
          <div className="status ok">
            tx: <span className="mono">{txHash}</span>
          </div>
        )}
      </div>

      <div className="card">
        <h2>What leaks?</h2>
        <p className="hint">Nothing that links the deposit to you.</p>
        {note ? (
          <PrivacyVisualizer
            title="Deposit"
            publicRows={[
              { k: "commitment", v: "0x" + commitment(note).toString(16).slice(0, 24) + "…" },
              { k: "amount", v: `${denomLabel} tPOT (pool-fixed, reveals nothing)` },
              { k: "depositor", v: "msg.sender (unlinkable to future withdrawal)" },
            ]}
            privateRows={[
              { k: "nullifier", v: note.nullifier.toString(16).slice(0, 20) + "…" },
              { k: "secret", v: note.secret.toString(16).slice(0, 20) + "…" },
              { k: "nullifierHash", v: nullifierHash(note).toString(16).slice(0, 20) + "…" },
            ]}
          />
        ) : (
          <p className="hint">Generate a note to see the on-chain vs. secret split.</p>
        )}
      </div>
    </div>
  );
}
