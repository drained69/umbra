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
  const [refs, setRefs] = useState<TxRef[]>([]);
  const isToken = asset.assetId !== null || asset.symbol !== "tPOT";

  function gen() {
    setNote(createNote(denomWei));
    setRefs([]);
    setStatus({ t: "info", m: "Note generated locally. Back it up — it is the ONLY way to withdraw." });
  }

  async function run() {
    if (!note) return;
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
      setStatus({ t: "ok", m: `Shielded ${denomLabel} ${asset.symbol}. It's now indistinguishable from every other deposit in this pool.` });
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
            <div className="note-box">{serializeNote(note)}</div>
            <button className="ghost" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(serializeNote(note))}>
              Copy backup
            </button>
            <button className="primary" style={{ marginTop: 8, marginLeft: 8 }} onClick={run} disabled={busy}>
              {busy ? "Depositing…" : `② Deposit ${denomLabel} ${asset.symbol}`}
            </button>
          </>
        )}
        {status && <div className={`status ${status.t}`}>{status.m}</div>}
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
        <p className="hint">Nothing that links the deposit to a future withdrawal.</p>
        {note ? (
          <PrivacyVisualizer
            title="Deposit"
            publicRows={[
              { k: "commitment", v: "0x" + commitment(note).toString(16).slice(0, 24) + "…" },
              { k: "amount", v: `${denomLabel} ${asset.symbol} (pool-fixed — reveals nothing)` },
              { k: "depositor", v: "visible, but unlinkable to the withdrawal" },
            ]}
            privateRows={[
              { k: "nullifier", v: note.nullifier.toString(16).slice(0, 20) + "…" },
              { k: "secret", v: note.secret.toString(16).slice(0, 20) + "…" },
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
