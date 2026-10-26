import { useState } from "react";
import { createNote, commitment, nullifierHash, serializeNote, encryptMemo, type Note } from "@umbra/sdk";
import PrivacyVisualizer from "./PrivacyVisualizer";
import type { AssetInfo } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

export interface TxRef {
  label: string;
  href?: string;
}

interface Props {
  asset: AssetInfo;
  denomLabel: string;
  denomWei: bigint;
  viewingKey: Uint8Array | null;
  wallet: Wallet;
  deposit: (note: Note, memo: Uint8Array) => Promise<TxRef[]>;
}

export default function DepositPanel({ asset, denomLabel, denomWei, viewingKey, wallet, deposit }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [refs, setRefs] = useState<TxRef[]>([]);
  const isToken = asset.assetId !== null || asset.symbol !== "tPOT";

  function gen() {
    setNote(createNote(denomWei));
    setBackupConfirmed(false);
    setRefs([]);
    setStatus({ t: "info", m: "Note generated locally. Back it up — it is the ONLY way to withdraw." });
  }

  async function run() {
    if (!note || !backupConfirmed) return;
    setBusy(true);
    setStatus({
      t: "info",
      m:
        wallet.kind === "native"
          ? `Sign in the Portaldot Extension${isToken ? " (an approval first, if this is your first deposit of this size)" : ""}…`
          : `Confirm in your EVM wallet${isToken ? " (approve, then deposit)" : ""}…`,
    });
    try {
      // Read-only memo: NO spend secrets (audit C-01).
      const memo = viewingKey
        ? encryptMemo(viewingKey, {
            action: "deposit",
            denomination: denomWei.toString(),
            commitment: commitment(note).toString(16),
            nullifierHash: nullifierHash(note).toString(16),
            ts: Date.now(),
          })
        : new Uint8Array();
      setRefs(await deposit(note, memo));
      setStatus({ t: "ok", m: `Deposited ${denomLabel} ${asset.symbol}. Keep your note backup safe; withdrawal privacy depends on activity in this pool.` });
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>
          Shield {denomLabel} {asset.symbol}
        </h2>
        <p className="hint">
          A random note is created in your browser. Only its <b>commitment</b> goes on-chain.
          {wallet.kind === "native" && " Your Portaldot account calls the pool directly via pallet-revive."}
          {asset.assetId !== null && ` ${asset.symbol} is Portaldot asset #${asset.assetId}, used through its ERC-20 precompile.`}
        </p>
        <button onClick={gen}>① Generate note</button>
        {note && (
          <>
            <div className="note-box" aria-label="Your private note backup">{serializeNote(note)}</div>
            <button className="ghost" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(serializeNote(note))}>
              Copy backup
            </button>
            <label className="backup-check"><input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} /> I saved my note backup somewhere private</label>
            <button className="primary" style={{ marginTop: 8 }} onClick={run} disabled={busy || !backupConfirmed || refs.length > 0}>
              {busy ? "Depositing…" : `② Deposit ${denomLabel} ${asset.symbol}`}
            </button>
          </>
        )}
        {status && <div className={`status ${status.t}`} role={status.t === "err" ? "alert" : "status"}>{status.m}</div>}
        {refs.length > 0 && (
          <div className="status ok">
            {refs.map((r, i) => (
              <div key={i}>
                {r.href ? (
                  <a href={r.href} target="_blank" rel="noreferrer">
                    {r.label} ↗
                  </a>
                ) : (
                  <span className="mono">{r.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>What leaks?</h2>
        <p className="hint">The pool hides which note is later spent. Timing and a small anonymity set can still reduce privacy.</p>
        {note ? (
          <PrivacyVisualizer
            title="Deposit"
            publicRows={[
              { k: "commitment", v: "0x" + commitment(note).toString(16).slice(0, 24) + "…" },
              { k: "amount", v: `${denomLabel} ${asset.symbol} (public pool size)` },
              { k: "depositor", v: "public wallet address" },
            ]}
            privateRows={[
              { k: "nullifier", v: "stored only in your note backup" },
              { k: "secret", v: "stored only in your note backup" },
              { k: "nullifierHash", v: nullifierHash(note).toString(16).slice(0, 20) + "… (revealed only at withdrawal)" },
            ]}
          />
        ) : (
          <p className="hint">Generate a note to see the on-chain vs. secret split.</p>
        )}
      </div>
    </div>
  );
}
