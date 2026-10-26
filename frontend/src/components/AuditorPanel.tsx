import { useState } from "react";
import {
  UmbraPoolClient,
  importViewingKey,
  exportViewingKey,
  scanMemos,
  type Memo,
} from "@umbra/sdk";
import { format } from "../lib/chain";

interface Props {
  client: UmbraPoolClient;
  myViewingKey: Uint8Array | null;
  denomLabel: string;
  decimals: number;
  symbol: string;
}

interface Row {
  memo: Memo;
  txHash?: string;
  blockNumber?: number;
  spent: boolean;
}

/**
 * Selective disclosure: privacy WITH optional auditability. History is encrypted to a
 * READ-ONLY viewing key. Handing it to an auditor reveals deposits and whether each was
 * later withdrawn — but grants no ability to move funds (memos carry no spend secrets).
 */
export default function AuditorPanel({ client, myViewingKey, denomLabel, decimals, symbol }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);

  async function scan(key: Uint8Array) {
    try {
      setStatus({ t: "info", m: "Scanning pool deposits and decrypting memos owned by this key…" });
      const deposits = await client.scanDeposits();
      const blobs = deposits
        .filter((d) => d.encryptedMemo && d.encryptedMemo !== "0x")
        .map((d) => ({ memo: hexToBytes(d.encryptedMemo), txHash: d.txHash, blockNumber: d.blockNumber }));
      const found = scanMemos(key, blobs);
      const withStatus: Row[] = await Promise.all(
        found.map(async (f) => ({
          ...f,
          spent: await client.isNullifierSpent(BigInt("0x" + f.memo.nullifierHash)),
        }))
      );
      setRows(withStatus);
      setStatus(
        withStatus.length
          ? { t: "ok", m: `Disclosed ${withStatus.length} deposit(s) belonging to this viewing key.` }
          : { t: "info", m: "No actions decrypt with this key in this pool." }
      );
    } catch (e: any) {
      setStatus({ t: "err", m: e?.message || String(e) });
    }
  }

  return (
    <div className="card">
      <h2>Viewing key &amp; selective disclosure</h2>
      <p className="hint">
        Review memo history for the {denomLabel} {symbol} pool, or share read-only access with someone you choose.
        This key cannot spend funds, but anyone holding it can inspect memos encrypted for it.
      </p>

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button disabled={!myViewingKey} onClick={() => myViewingKey && scan(myViewingKey)}>
          Reveal MY history
        </button>
        <button
          className="ghost"
          disabled={!myViewingKey}
          onClick={() => myViewingKey && navigator.clipboard.writeText(exportViewingKey(myViewingKey))}
        >
          Copy my viewing key (share with auditor)
        </button>
      </div>

      <label htmlFor="shared-viewing-key">Or audit someone who shared their key</label>
      <div className="row">
        <input id="shared-viewing-key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="umbra-vk-…" spellCheck={false} autoCapitalize="off" autoComplete="off" />
        <button
          onClick={() => {
            try {
              scan(importViewingKey(keyInput));
            } catch {
              setStatus({ t: "err", m: "invalid viewing key" });
            }
          }}
        >
          Audit
        </button>
      </div>

      {status && <div className={`status ${status.t}`} role={status.t === "err" ? "alert" : "status"}>{status.m}</div>}

      {rows.length > 0 && (
        <table className="disc">
          <thead>
            <tr>
              <th>Action</th>
              <th>Amount ({symbol})</th>
              <th>Status</th>
              <th>When</th>
              <th>Commitment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.memo.action}</td>
                <td>{format(BigInt(r.memo.denomination), decimals)}</td>
                <td>{r.spent ? "withdrawn" : "shielded"}</td>
                <td>{new Date(r.memo.ts).toLocaleString()}</td>
                <td className="mono">0x{r.memo.commitment.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
