import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FIELD_SIZE, Keypair, UmbraShieldedClient, parseMemo, toUnits, type Utxo } from "@umbra/sdk";
import { DEPLOYMENT, readProvider } from "./chain";
import { findMyRequest, markRequestPaid } from "./finance";
import { readStored, storeKey, writeStored } from "./store";
import { SHIELDED_POOL } from "./shielded";

/**
 * One private (shielded) account for the whole app: payments, requests and swaps all spend
 * from and receive into it. Its spend key can be remembered in this browser (opt-in); anyone
 * with access to this browser profile could then spend the private balance.
 */
interface Saved {
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
  remembered: boolean;
  balance: bigint | null;
  spendable: bigint;
  notes: Utxo[]; // unspent
  history: ReceivedNote[]; // every note received, newest first
  scanning: boolean;
  error: string | null;
  create(remember: boolean): Keypair;
  restore(serialized: string, remember: boolean): void;
  confirmBackup(): void;
  setRemembered(remember: boolean): void;
  lock(): void;
  refresh(): Promise<void>;
}

const Ctx = createContext<PrivateAccount | null>(null);
const KEY = storeKey("private");

export function PrivateAccountProvider({ children }: { children: ReactNode }) {
  const ready = !!SHIELDED_POOL && SHIELDED_POOL !== "0x0000000000000000000000000000000000000000";
  const client = useMemo(() => new UmbraShieldedClient(SHIELDED_POOL, readProvider, { deployBlock: DEPLOYMENT.deployBlock ?? 0 }), []);
  const saved = readStored<Saved | null>(KEY, null);
  const [owner, setOwner] = useState<Keypair | null>(() => (saved ? Keypair.fromSerialized(saved.sk) : null));
  const [backedUp, setBackedUp] = useState(saved?.backedUp ?? false);
  const [remembered, setRememberedState] = useState(!!saved);
  const [notes, setNotes] = useState<Utxo[]>([]);
  const [history, setHistory] = useState<ReceivedNote[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = (key: Keypair | null, remember: boolean, backed: boolean) => {
    writeStored(KEY, remember && key ? ({ sk: key.serialize(), backedUp: backed } satisfies Saved) : undefined);
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

  const value: PrivateAccount = {
    client,
    ready,
    owner,
    backedUp,
    remembered,
    balance,
    spendable: UmbraShieldedClient.spendable(notes),
    notes,
    history,
    scanning,
    error,
    create(remember) {
      const key = new Keypair();
      setOwner(key);
      setBackedUp(false);
      setRememberedState(remember);
      persist(key, remember, false);
      return key;
    },
    restore(serialized, remember) {
      const s = serialized.trim();
      if (!/^umbra-sk-[0-9a-fA-F]{64}$/.test(s)) throw new Error("Enter a complete umbra-sk- spend key.");
      const key = Keypair.fromSerialized(s);
      if (key.privateKey === 0n || key.privateKey >= FIELD_SIZE) throw new Error("Spend key is outside the valid field range.");
      setOwner(key);
      setBackedUp(true);
      setRememberedState(remember);
      persist(key, remember, true);
    },
    confirmBackup() {
      setBackedUp(true);
      persist(owner, remembered, true);
    },
    setRemembered(remember) {
      setRememberedState(remember);
      persist(owner, remember, backedUp);
    },
    lock() {
      setOwner(null);
      setBackedUp(false);
      setRememberedState(false);
      persist(null, false, false);
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
