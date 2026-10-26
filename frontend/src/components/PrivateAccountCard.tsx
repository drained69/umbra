import { useState } from "react";
import { format, NATIVE } from "../lib/chain";
import { usePrivateAccount } from "../lib/privateAccount";
import CopyButton from "./CopyButton";

/** Create, restore and back up the app-wide private account. */
export default function PrivateAccountCard({ compact = false }: { compact?: boolean }) {
  const pa = usePrivateAccount();
  const [restoreKey, setRestoreKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [showRestore, setShowRestore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!pa.ready) return <div className="notice-card"><span>ⓘ</span><div><strong>Private account unavailable</strong><p>No join-split pool is configured for this network.</p></div></div>;

  if (!pa.owner) {
    return (
      <div className="card" id="private-account">
        <h2>Private account</h2>
        <p className="hint">Get a private address for receiving encrypted payments. Its spend key is the only way to move the balance, so you'll be asked to save it.</p>
        <label className="check-row"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember it in this browser. Anyone using this browser profile could then spend it.</label>
        <div className="row">
          <button className="primary" onClick={() => { setErr(null); pa.create(remember); }}>Create private account</button>
          <button className="text-button" onClick={() => setShowRestore(!showRestore)} aria-expanded={showRestore}>{showRestore ? "Cancel" : "I already have a spend key"}</button>
        </div>
        {showRestore && <>
          <label htmlFor="pa-restore">Spend key</label>
          <textarea id="pa-restore" className="short" value={restoreKey} onChange={(e) => setRestoreKey(e.target.value)} placeholder="umbra-sk-…" spellCheck={false} autoCapitalize="off" autoComplete="off" />
          <button style={{ marginTop: 10 }} onClick={() => { try { setErr(null); pa.restore(restoreKey, remember); setRestoreKey(""); setShowRestore(false); } catch (e: any) { setErr(e.message); } }} disabled={!restoreKey.trim()}>Restore account</button>
        </>}
        {err && <div className="status err" role="alert">{err}</div>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title-row">
        <h2>Private account</h2>
        <button className="text-button" onClick={() => pa.refresh()} disabled={pa.scanning}>{pa.scanning ? "Scanning…" : "Refresh"}</button>
      </div>
      <p className="big-balance">{pa.balance === null ? "…" : format(pa.balance, 18)} <small>{NATIVE} private</small></p>
      {pa.notes.length > 2 && <p className="hint">Spread across {pa.notes.length} notes; one payment can spend up to {format(pa.spendable, 18)} {NATIVE}.</p>}
      {pa.error && <div className="status err" role="alert">{pa.error}</div>}
      {!pa.backedUp && (
        <div className="backup-box">
          <strong>Save your spend key</strong>
          <p className="hint">Without it this balance cannot be recovered in another browser.</p>
          <textarea readOnly value={pa.owner.serialize()} aria-label="Spend key" />
          <div className="row"><CopyButton value={pa.owner!.serialize()}>Copy spend key</CopyButton><button className="primary" onClick={pa.confirmBackup}>I saved it</button></div>
        </div>
      )}
      {!compact && (
        <div className="row" style={{ marginTop: 12 }}>
          <label className="row check-row" style={{ margin: 0 }}><input type="checkbox" checked={pa.remembered} onChange={(e) => pa.setRemembered(e.target.checked)} />Remember in this browser</label>
          <button className="text-button" onClick={() => { if (pa.backedUp || confirm("You have not confirmed a backup of the spend key. Lock anyway?")) pa.lock(); }}>Lock</button>
        </div>
      )}
    </div>
  );
}
