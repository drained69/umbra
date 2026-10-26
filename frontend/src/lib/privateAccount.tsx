import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FIELD_SIZE, Keypair, UmbraShieldedClient, parseMemo, toUnits, type Utxo } from "@umbra/sdk";
import { DEPLOYMENT, SCAN_CHUNK, readProvider } from "./chain";
import { findMyRequest, markRequestPaid } from "./finance";
import { readStored, storeKey, writeStored } from "./store";
import { SHIELDED_POOL } from "./shielded";
import { isSealed, passcodeProblem, seal, unseal, type SealedSecret } from "./vault";

/**
 * One private (shielded) account for the whole app: payments, requests and swaps all spend
 * from and receive into it. Its spend key can be remembered in this browser, encrypted with
 * a passcode (lib/vault.ts); after a reload the account stays locked until the passcode is
 * entered. Keys saved by earlier versions without a passcode still load, flagged for upgrade.
 */
interface LegacyPlain {
  sk: string;
  backedUp: boolean;
}

export interface ReceivedNote {
  utxo: Utxo;
  spent: boolean;
  requestId?: string;
  text: string;
}

interface PrivateAccount {
  client: UmbraShieldedClient;
  ready: boolean; // a join-split pool is configured
  owner: Keypair | null;
  backedUp: boolean;
  /** an encrypted copy is saved in this browser */
  remembered: boolean;
  /** a saved account exists but has not been unlocked this session */
  locked: boolean;
  /** saved by an earlier version without a passcode */
  needsPasscode: boolean;
  balance: bigint | null;
  spendable: bigint;
  notes: Utxo[]; // unspent
  history: ReceivedNote[]; // every note received, newest first
  scanning: boolean;
  error: string | null;
  /** passcode set => remember this account, encrypted */
  create(passcode: string | null): Promise<Keypair>;
  restore(serialized: string, passcode: string | null): Promise<void>;
  unlock(passcode: string): Promise<void>;
  /** save (or re-save) the open account under a passcode */
  remember(passcode: string): Promise<void>;
  /** delete the saved copy; the open account stays usable this session */
  stopRemembering(): void;
  confirmBackup(): void;
  /** close the account for this session; a saved encrypted copy remains */
  lock(): void;
  /** close the account and delete any saved copy from this browser */
  forget(): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<PrivateAccount | null>(null);
const KEY = storeKey("private");

function parseSpendKey(serialized: string): Keypair {
  const s = serialized.trim();
  if (!/^umbra-sk-[0-9a-fA-F]{64}$/.test(s)) throw new Error("Enter a complete umbra-sk- spend key.");
  const key = Keypair.fromSerialized(s);
  if (key.privateKey === 0n || key.privateKey >= FIELD_SIZE) throw new Error("Spend key is outside the valid field range.");
  return key;
}

export function PrivateAccountProvider({ children }: { children: ReactNode }) {
  const ready = !!SHIELDED_POOL && SHIELDED_POOL !== "0x0000000000000000000000000000000000000000";
  const client = useMemo(() => new UmbraShieldedClient(SHIELDED_POOL, readProvider, { deployBlock: DEPLOYMENT.deployBlock ?? 0, chunkSize: SCAN_CHUNK }), []);
  const [saved, setSaved] = useState<SealedSecret | LegacyPlain | null>(() => readStored<SealedSecret | LegacyPlain | null>(KEY, null));
  const legacy = !!saved && !isSealed(saved);
  const [owner, setOwner] = useState<Keypair | null>(() => (saved && !isSealed(saved) ? Keypair.fromSerialized(saved.sk) : null));
  const [backedUp, setBackedUp] = useState(saved?.backedUp ?? false);
  const [notes, setNotes] = useState<Utxo[]>([]);
  const [history, setHistory] = useState<ReceivedNote[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = (value: SealedSecret | null) => {
    writeStored(KEY, value ?? undefined);
    setSaved(value);
  };

  const refresh = useCallback(async () => {
    if (!owner || !ready) return;
    setScanning(true);
    setError(null);
    try {
      const all = await client.myNotes(owner);
      const unspent = all.filter((n) => !n.spent).map((n) => n.utxo);
      setNotes(unspent);
      setBalance(unspent.reduce((s, u) => s + u.amount, 0n));
      const hist = all.map((n) => ({ ...n, ...parseMemo(n.utxo.memo) })).reverse();
      setHistory(hist);
      // A private payment carries its request id in the encrypted memo: settle matching requests.
      for (const h of hist) {
        if (!h.requestId) continue;
        const mine = findMyRequest(h.requestId);
        if (mine?.status === "open" && h.utxo.amount >= toUnits(mine.request.amount, 18)) markRequestPaid(h.requestId, "private");
      }
    } catch (e: any) {
      setError(`Private balance scan failed: ${e?.message ?? e}`);
    } finally {
      setScanning(false);
    }
  }, [owner, client, ready]);

  useEffect(() => {
    setNotes([]);
    setHistory([]);
    setBalance(null);
    refresh();
  }, [refresh]);

  const open = async (key: Keypair, backed: boolean, passcode: string | null) => {
    if (passcode !== null) {
      const problem = passcodeProblem(passcode);
      if (problem) throw new Error(problem);
      store(await seal(key.serialize(), passcode, backed));
    } else if (saved) {
      store(null); // a new account replaces any saved one; never leave a stale key behind
    }
    setOwner(key);
    setBackedUp(backed);
  };

  const value: PrivateAccount = {
    client,
    ready,
    owner,
    backedUp,
    remembered: !!saved && isSealed(saved),
    locked: !owner && !!saved && isSealed(saved),
    needsPasscode: !!owner && legacy,
    balance,
    spendable: UmbraShieldedClient.spendable(notes),
    notes,
    history,
    scanning,
    error,
    async create(passcode) {
      const key = new Keypair();
      await open(key, false, passcode);
      return key;
    },
    async restore(serialized, passcode) {
      await open(parseSpendKey(serialized), true, passcode);
    },
    async unlock(passcode) {
      if (!saved || !isSealed(saved)) throw new Error("No saved account to unlock.");
      const key = parseSpendKey(await unseal(saved, passcode));
      setOwner(key);
      setBackedUp(saved.backedUp);
    },
    async remember(passcode) {
      if (!owner) throw new Error("Open an account first.");
      const problem = passcodeProblem(passcode);
      if (problem) throw new Error(problem);
      store(await seal(owner.serialize(), passcode, backedUp)); // also replaces an unencrypted legacy copy
    },
    stopRemembering() {
      store(null);
    },
    confirmBackup() {
      setBackedUp(true);
      if (saved && isSealed(saved)) store({ ...saved, backedUp: true });
    },
    lock() {
      if (legacy) store(null); // never keep an unencrypted key around after locking
      setOwner(null);
    },
    forget() {
      store(null);
      setOwner(null);
      setBackedUp(false);
    },
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrivateAccount(): PrivateAccount {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrivateAccount must be used inside PrivateAccountProvider");
  return ctx;
}
