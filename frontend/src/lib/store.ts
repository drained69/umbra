import { useCallback, useEffect, useState } from "react";
import { DEPLOYMENT } from "./chain";

// Per-browser app state (contacts, requests, activity). Every read and write is guarded:
// storage can be unavailable (private windows, blocked site data) and the app must still work.

const EVENT = "umbra-store";

export const storeKey = (name: string) => `umbra:${DEPLOYMENT.chainId}:${name}`;

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored<T>(key: string, value: T): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not persisted; in-memory state still updates */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }));
}

/** useState backed by localStorage, kept in sync across components and tabs. */
export function useStored<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => {
    const local = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.key === key) setValue(d.value ?? fallback);
    };
    const other = (e: StorageEvent) => {
      if (e.key === key) setValue(readStored(key, fallback));
    };
    window.addEventListener(EVENT, local);
    window.addEventListener("storage", other);
    return () => {
      window.removeEventListener(EVENT, local);
      window.removeEventListener("storage", other);
    };
  }, [key]);
  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(readStored(key, fallback)) : next;
      writeStored(key, resolved);
    },
    [key]
  );
  return [value, update];
}
