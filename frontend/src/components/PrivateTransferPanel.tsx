import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { FIELD_SIZE, Keypair, SHIELDED_POOL_ABI, UmbraShieldedClient, Utxo, buildReviveCall, sendNative } from "@umbra/sdk";
import { DEPLOYMENT, NATIVE, format, getApi, readProvider, short, blockLink } from "../lib/chain";
import type { Wallet } from "../lib/wallet";

const ARTIFACTS = { wasm: "/zk/transaction.wasm", zkey: "/zk/transaction_final.zkey" };
const POOL = new ethers.Interface(SHIELDED_POOL_ABI);
type Action = "deposit" | "send" | "withdraw";

export default function PrivateTransferPanel({ wallet }: { wallet: Wallet }) {
  const poolAddress = DEPLOYMENT.contracts.shieldedPool as string;
  const client = useMemo(() => new UmbraShieldedClient(poolAddress, readProvider, { deployBlock: DEPLOYMENT.deployBlock ?? 0 }), [poolAddress]);
  const [owner, setOwner] = useState<Keypair | null>(null);
  const [backup, setBackup] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [notes, setNotes] = useState<Utxo[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "err"; message: string; href?: string } | null>(null);

  async function refresh(key: Keypair) {
    const found = await client.myUtxos(key);
    setNotes(found);
    setBalance(found.reduce((sum, note) => sum + note.amount, 0n));
  }

  useEffect(() => {
    if (!owner) return;
    refresh(owner).catch((e) => setStatus({ kind: "err", message: `Balance scan failed: ${e.message}` }));
  }, [owner, client]);

  function createAccount() {
    const key = new Keypair();
    setOwner(key);
    setBackup(key.serialize());
    setBackupConfirmed(false);
    setBalance(null);
    setStatus({ kind: "info", message: "Save the spend key before depositing. Anyone with this key can spend your private balance." });
  }

  function restoreAccount() {
    try {
      if (!/^umbra-sk-[0-9a-fA-F]{64}$/.test(backup.trim())) throw new Error("Enter a complete umbra-sk- spend key.");
      const key = Keypair.fromSerialized(backup.trim());
      if (key.privateKey === 0n || key.privateKey >= FIELD_SIZE) throw new Error("Spend key is outside the valid field range.");
      setOwner(key);
      setBackupConfirmed(true);
      setBalance(null);
      setStatus({ kind: "info", message: "Scanning the pool for your private balance…" });
    } catch (e: any) {
      setStatus({ kind: "err", message: e.message });
    }
  }

  async function submit() {
    if (!owner || !backupConfirmed) return;
    setBusy(true);
    setStatus(null);
    try {
      const value = ethers.parseUnits(amount.trim(), 18);
      if (value <= 0n) throw new Error("Enter an amount greater than zero.");
      let inputs: Utxo[] = [];
      let outputs: Utxo[] = [];
      let extAmount = 0n;
      let payout = ethers.ZeroAddress;

      if (action === "deposit") {
        extAmount = value;
        outputs = [new Utxo({ amount: value, keypair: owner })];
      } else {
        const available = await client.myUtxos(owner);
        setNotes(available);
        setBalance(available.reduce((sum, note) => sum + note.amount, 0n));
        inputs = [...available].sort((a, b) => a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1).slice(0, 2);
        const total = inputs.reduce((sum, note) => sum + note.amount, 0n);
        if (total < value) throw new Error("This action can use at most two private notes. Choose a smaller amount or consolidate notes first.");
        const change = total - value;
        if (action === "send") {
          const to = Keypair.fromAddress(recipient.trim());
          outputs = [new Utxo({ amount: value, keypair: to })];
        } else {
          if (!ethers.isAddress(recipient.trim())) throw new Error("Enter a valid 0x withdrawal address.");
          payout = ethers.getAddress(recipient.trim());
          extAmount = -value;
        }
        if (change > 0n) outputs.push(new Utxo({ amount: change, keypair: owner }));
      }

      setStatus({ kind: "info", message: "Scanning commitments and generating a zero-knowledge proof in your browser…" });
      const { proof, ext } = await client.prepare({ inputs, outputs, owner, extAmount, recipient: payout, artifacts: ARTIFACTS });
      const [args, extData] = UmbraShieldedClient.encodeArgs(proof, ext);
      let href: string | undefined;
      let reference: string;
      if (wallet.kind === "evm") {
        const contract = new ethers.Contract(poolAddress, SHIELDED_POOL_ABI, wallet.signer);
        setStatus({ kind: "info", message: "Confirm the transaction in your wallet…" });
        const tx = await contract.transact(args, extData, { value: extAmount > 0n ? extAmount : 0n });
        const receipt = await tx.wait();
        reference = short(receipt.hash);
        href = blockLink(receipt.blockHash);
      } else {
        const api = await getApi();
        const data = POOL.encodeFunctionData("transact", [args, extData]);
        const call = await buildReviveCall(api, wallet.account, poolAddress, data, extAmount > 0n ? extAmount : 0n, { abi: SHIELDED_POOL_ABI });
        setStatus({ kind: "info", message: "Sign the transaction in the Portaldot Extension…" });
        const result = await sendNative(api, wallet.account, [call], { signer: wallet.signer });
        reference = short(result.blockHash);
        href = blockLink(result.blockHash);
      }
      await refresh(owner).catch(() => {
        setBalance(null);
      });
      setAmount("");
      setStatus({ kind: "ok", message: `${action === "deposit" ? "Deposited" : action === "send" ? "Sent privately" : "Withdrawn"} · ${reference}`, href });
    } catch (e: any) {
      setStatus({ kind: "err", message: e?.shortMessage || e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid">
    <div className="card">
      <h2>Your private account</h2>
      <p className="hint">A separate shielded address receives encrypted notes. Save its spend key to recover your balance in another browser.</p>
      {!owner ? <>
        <button className="primary" onClick={createAccount}>Create private account</button>
        <label style={{ display: "block", marginTop: 16 }}>Or restore a spend key</label>
        <textarea value={backup} onChange={(e) => setBackup(e.target.value)} placeholder="umbra-sk-…" />
        <button className="ghost" onClick={restoreAccount}>Restore account</button>
      </> : <>
        <p><strong>Private balance:</strong> {balance === null ? "Scanning…" : `${format(balance, 18)} ${NATIVE}`}</p>
        <p className="hint">{notes.length} unspent note{notes.length === 1 ? "" : "s"}</p>
        <label>Shareable shielded address</label>
        <textarea readOnly value={owner.address()} />
        <button className="ghost" onClick={() => navigator.clipboard.writeText(owner.address())}>Copy address</button>
        {!backupConfirmed && <>
          <label style={{ display: "block", marginTop: 16 }}>Spend key — save it securely</label>
          <textarea readOnly value={owner.serialize()} />
          <button className="ghost" onClick={() => navigator.clipboard.writeText(owner.serialize())}>Copy spend key</button>
          <label className="row" style={{ marginTop: 12 }}><input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} />I saved my spend key</label>
        </>}
        <button className="ghost" style={{ marginTop: 12 }} onClick={() => refresh(owner).catch((e) => setStatus({ kind: "err", message: e.message }))}>Refresh balance</button>
      </>}
    </div>
    <div className="card">
      <h2>Move private {NATIVE}</h2>
      <p className="hint">Deposit any amount, send to another shielded address, or withdraw to a 0x wallet.</p>
      <div className="denoms">{(["deposit", "send", "withdraw"] as Action[]).map((item) => <button key={item} className={`chip ${action === item ? "active" : ""}`} onClick={() => { setAction(item); setStatus(null); }}>{item === "send" ? "Send privately" : item === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
      <label style={{ display: "block", marginTop: 16 }}>Amount in {NATIVE}</label>
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.0" />
      {action !== "deposit" && <><label>{action === "send" ? "Recipient’s shielded address" : "Recipient’s 0x address"}</label><textarea value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={action === "send" ? "umbra-addr-…" : "0x…"} /></>}
      {action === "send" && <p className="hint">The recipient and amount are encrypted in the pool. Your gas-paying wallet remains visible on-chain.</p>}
      <button className="primary" onClick={submit} disabled={!owner || !backupConfirmed || busy}>{busy ? "Working…" : action === "send" ? "Send privately" : action === "deposit" ? "Deposit privately" : "Withdraw"}</button>
      {status && <div className={`status ${status.kind}`}>{status.message} {status.href && <a href={status.href} target="_blank" rel="noreferrer">View block ↗</a>}</div>}
    </div>
  </div>;
}
