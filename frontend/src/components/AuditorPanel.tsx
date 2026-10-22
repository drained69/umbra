import { useState } from "react";
import {
  UmbraPoolClient,
  importViewingKey,
  exportViewingKey,
  scanMemos,
  type Memo,
} from "@umbra/sdk";

interface Props {
  client: UmbraPoolClient;
  myViewingKey: Uint8Array | null;
  denomLabel: string;
}

/**
 * Selective disclosure: privacy WITH optional auditability. Your history is encrypted to
 * a viewing key. You can read your own; or hand the key to an auditor who can then — and
 * ONLY then — reconstruct exactly your activity, with nothing exposed publicly.
 */
export default function AuditorPanel({ client, myViewingKey, denomLabel }: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [rows, setRows] = useState<{ memo: Memo; txHash?: string; blockNumber?: number }[]>([]);
  const [status, setStatus] = useState<{ t: "ok" | "err" | "info"; m: string } | null>(null);

  async function scan(key: Uint8Array) {
    setStatus({ t: "info", m: "Scanning pool deposits and decrypting memos owned by this key…" });
    const deposits = await client.scanDeposits();
    const blobs = deposits
      .filter((d) => d.encryptedMemo && d.encryptedMemo !== "0x")
      .map((d) => ({
        memo: hexToBytes(d.encryptedMemo),
        txHash: d.txHash,
        blockNumber: d.blockNumber,
      }));
    const found = scanMemos(key, blobs);
    setRows(found);
    setStatus(
      found.length
        ? { t: "ok", m: `Disclosed ${found.length} action(s) belonging to this viewing key.` }
        : { t: "info", m: "No actions decrypt with this key in this pool." }
    );
  }

  return (
    <div className="card">
      <h2>Viewing key &amp; selective disclosure</h2>
      <p className="hint">
        Compliance without surveillance. Reveal your {denomLabel}-pool history to yourself, or to an
        auditor you choose — no one else, ever.
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

      <label>Or audit someone who shared their key</label>
      <div className="row">
        <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="umbra-vk-…" />
        <button
          onClick={() => {
            try {
              scan(importViewingKey(keyInput));
            } catch (e: any) {
              setStatus({ t: "err", m: "invalid viewing key" });
            }
          }}
        >
          Audit
        </button>
      </div>

      {status && <div className={`status ${status.t}`}>{status.m}</div>}

      {rows.length > 0 && (
        <table className="disc">
          <thead>
            <tr>
              <th>Action</th>
              <th>Amount (tPOT)</th>
              <th>When</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.memo.action}</td>
                <td>{Number(BigInt(r.memo.denomination)) / 1e14}</td>
                <td>{new Date(r.memo.ts).toLocaleString()}</td>
                <td className="mono">{r.txHash?.slice(0, 12)}…</td>
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
