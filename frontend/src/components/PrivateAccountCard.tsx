import { useState } from "react";
import { format, NATIVE } from "../lib/chain";
import { usePrivateAccount } from "../lib/privateAccount";
import { MIN_PASSCODE, passcodeProblem } from "../lib/vault";
import CopyButton from "./CopyButton";
import { MA } from "../lib/multi";
import { fmt } from "../lib/finance";

/** Passcode + confirmation inputs. */
function PasscodeFields({ value, confirm, onChange, idPrefix }: { value: string; confirm: string; onChange: (v: string, c: string) => void; idPrefix: string }) {
  return (
    <div className="two-col">
      <div><label htmlFor={`${idPrefix}-pass`}>Passcode</label><input id={`${idPrefix}-pass`} type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value, confirm)} placeholder={`At least ${MIN_PASSCODE} characters`} /></div>
      <div><label htmlFor={`${idPrefix}-confirm`}>Repeat passcode</label><input id={`${idPrefix}-confirm`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => onChange(value, e.target.value)} /></div>
    </div>
  );
}

/** Create, restore, unlock and back up the app-wide private account. */
export default function PrivateAccountCard({ compact = false }: { compact?: boolean }) {
  const pa = usePrivateAccount();
  const [restoreKey, setRestoreKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [showRestore, setShowRestore] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setPass(""); setPass2(""); setErr(null); };
  async function act(f: () => Promise<void>) {
    setErr(null);
    setBusy(true);
    try {
      await f();
      reset();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }
  const passProblem = remember ? passcodeProblem(pass, pass2) : null;
  const privateAssets = MA?.assets.filter((asset) => asset.id !== 0) ?? [];
  const balanceLabel = pa.balance === null ? (pa.error ? "Unavailable" : "Scanning…") : fmt(pa.balance, 18, 4);

  if (!pa.ready) return <div className="notice-card"><span>ⓘ</span><div><strong>Private account unavailable</strong><p>Private accounts have not been set up on this network yet.</p></div></div>;

  if (pa.locked) {
    return (
      <div className="card" id="private-account">
        <h2>Unlock your private account</h2>
        <p className="hint">Your private account is saved in this browser, encrypted with your passcode.</p>
        <form onSubmit={(e) => { e.preventDefault(); act(() => pa.unlock(pass)); }}>
          <label htmlFor="pa-unlock">Passcode</label>
          <input id="pa-unlock" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus={!compact} />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" type="submit" disabled={!pass || busy}>{busy ? "Unlocking…" : "Unlock"}</button>
            <button type="button" className="text-button" onClick={() => { if (confirm("Remove the saved private account from this browser? You can restore it later only with its spend key.")) { pa.forget(); reset(); } }}>Forget this account</button>
          </div>
        </form>
        {err && <div className="status err" role="alert">{err}</div>}
      </div>
    );
  }

  if (!pa.owner) {
    return (
      <div className="card" id="private-account">
        <h2>Private account</h2>
        <p className="hint">Get a private address for receiving encrypted payments. Its spend key is the only way to move the balance, so you'll be asked to save it.</p>
        <label className="check-row"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember it in this browser, protected by a passcode</label>
        {remember && <PasscodeFields idPrefix="pa-new" value={pass} confirm={pass2} onChange={(v, c) => { setPass(v); setPass2(c); }} />}
        {remember && pass && passProblem && <p className="hint" style={{ margin: "8px 0 0" }}>{passProblem}</p>}
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" disabled={busy || !!passProblem} onClick={() => act(async () => { await pa.create(remember ? pass : null); })}>{busy ? "Securing…" : "Create private account"}</button>
          <button className="text-button" onClick={() => setShowRestore(!showRestore)} aria-expanded={showRestore}>{showRestore ? "Cancel" : "I already have a spend key"}</button>
        </div>
        {showRestore && <>
          <label htmlFor="pa-restore">Spend key</label>
          <textarea id="pa-restore" className="short" value={restoreKey} onChange={(e) => setRestoreKey(e.target.value)} placeholder="umbra-sk-…" spellCheck={false} autoCapitalize="off" autoComplete="off" />
          <button style={{ marginTop: 10 }} disabled={!restoreKey.trim() || busy || !!passProblem} onClick={() => act(async () => { await pa.restore(restoreKey, remember ? pass : null); setRestoreKey(""); setShowRestore(false); })}>Restore account</button>
        </>}
        {err && <div className="status err" role="alert">{err}</div>}
      </div>
    );
  }

  return (
    <div className="card" id="private-account">
      <div className="card-title-row">
        <h2>Private account</h2>
        <button className="text-button" onClick={() => pa.refresh()} disabled={pa.scanning}>{pa.scanning ? "Scanning…" : "Refresh"}</button>
      </div>
      <div className="private-balance-list" aria-label="Private balances" aria-busy={pa.scanning}>
        <div className="private-balance-item">
          <span className="balance-label">{NATIVE} balance</span>
          <strong>{balanceLabel} <small>{NATIVE}</small></strong>
        </div>
        {privateAssets.map((asset) => <div className="private-balance-item" key={asset.id}>
          <span className="balance-label">{asset.symbol} balance</span>
          <strong>{pa.balance === null ? (pa.error ? "Unavailable" : "Scanning…") : fmt(pa.maBalances.get(BigInt(asset.id)) ?? 0n, asset.decimals, 4)} <small>{asset.symbol}</small></strong>
        </div>)}
      </div>
      {pa.notes.length > 2 && <p className="hint">Spread across {pa.notes.length} notes; one payment can spend up to {format(pa.spendable, 18)} {NATIVE}.</p>}
      {pa.error && <div className="status err" role="alert">{pa.error}</div>}
      {pa.needsPasscode && (
        <div className="backup-box">
          <strong>Protect your saved key</strong>
          <p className="hint">This browser stores your spend key without a passcode. Set one to keep it saved securely.</p>
          <PasscodeFields idPrefix="pa-legacy" value={pass} confirm={pass2} onChange={(v, c) => { setPass(v); setPass2(c); }} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy || !!passcodeProblem(pass, pass2)} onClick={() => act(() => pa.remember(pass))}>Set passcode</button>
            <button className="text-button" onClick={() => pa.stopRemembering()}>Stop saving it</button>
          </div>
        </div>
      )}
      {!pa.backedUp && (
        <div className="backup-box">
          <strong>Save your spend key</strong>
          <p className="hint">Without it this balance cannot be recovered in another browser.</p>
          <textarea readOnly value={pa.owner.serialize()} aria-label="Spend key" />
          <div className="row"><CopyButton value={pa.owner.serialize()}>Copy spend key</CopyButton><button className="primary" onClick={pa.confirmBackup}>I saved it</button></div>
        </div>
      )}
      {!compact && !pa.needsPasscode && (
        <div className="account-footer">
          <span className="hint" style={{ margin: 0 }}>{pa.remembered ? "Saved in this browser, encrypted with your passcode." : "Not saved in this browser. You will need your spend key next time."}</span>
          <div className="row">
            {pa.remembered ? <>
              <button className="text-button" onClick={() => pa.lock()}>Lock</button>
              <button className="text-button" onClick={() => { if (pa.backedUp || confirm("You have not confirmed a backup of the spend key. Remove it from this browser anyway?")) pa.forget(); }}>Forget</button>
            </> : <>
              <button className="text-button" onClick={() => setShowSave(!showSave)} aria-expanded={showSave}>{showSave ? "Cancel" : "Save with a passcode"}</button>
              <button className="text-button" onClick={() => { if (pa.backedUp || confirm("You have not confirmed a backup of the spend key. Close the account anyway?")) pa.forget(); }}>Close account</button>
            </>}
          </div>
          {showSave && !pa.remembered && <>
            <PasscodeFields idPrefix="pa-save" value={pass} confirm={pass2} onChange={(v, c) => { setPass(v); setPass2(c); }} />
            <button style={{ marginTop: 10 }} disabled={busy || !!passcodeProblem(pass, pass2)} onClick={() => act(async () => { await pa.remember(pass); setShowSave(false); })}>Save</button>
          </>}
        </div>
      )}
      {err && <div className="status err" role="alert">{err}</div>}
    </div>
  );
}
