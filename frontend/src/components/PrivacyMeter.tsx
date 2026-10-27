import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { readProvider } from "../lib/chain";
import { SHIELDED_POOL } from "../lib/shielded";
import { MA } from "../lib/multi";

/**
 * How much cover a pool gives: privacy comes from blending in with other deposits.
 * `n` is the anonymity set the user cares about — all deposits in a pool, or the deposits
 * made since theirs (an earlier withdrawal can only be one of those, plus their own).
 */
export function privacyLevel(n: number): { level: 0 | 1 | 2 | 3; label: string } {
  if (n < 5) return { level: 0, label: "Very low" };
  if (n < 20) return { level: 1, label: "Low" };
  if (n < 100) return { level: 2, label: "Fair" };
  return { level: 3, label: "Strong" };
}

/** Number of deposits (tree leaves) in a pool, read from its `nextIndex`. */
export function usePoolSize(address: string | undefined, refreshKey: unknown = 0): number | null {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    setSize(null);
    if (!address || address === ethers.ZeroAddress) return;
    let stop = false;
    new ethers.Contract(address, ["function nextIndex() view returns (uint32)"], readProvider)
      .nextIndex()
      .then((n: bigint) => !stop && setSize(Number(n)))
      .catch(() => {});
    return () => { stop = true; };
  }, [address, refreshKey]);
  return size;
}

/**
 * Cover in the private (join-split) pool. Every private transaction adds two notes (one may
 * be a zero-value filler), so transactions — notes / 2 — is the honest count.
 */
export function PrivatePoolMeter({ refreshKey = 0 }: { refreshKey?: unknown }) {
  // new private activity happens in the multi-asset pool once it exists
  const notes = usePoolSize(MA?.address ?? SHIELDED_POOL, refreshKey);
  const txs = notes === null ? null : Math.floor(notes / 2);
  return (
    <PrivacyMeter
      n={txs}
      title="Private pool activity"
      detail={txs === 0
        ? "No one has used the private pool yet. Until others do, your private activity is easy to trace."
        : txs !== null && txs < 5
          ? `Only ${txs} private transaction${txs === 1 ? "" : "s"} so far, so your activity is easier to trace. It gets stronger as more people use Umbra.`
          : `${txs ?? "…"} private transactions so far. Your payment blends in with them.`}
    />
  );
}

interface Props {
  /** anonymity set size; null while loading */
  n: number | null;
  title: string;
  detail: string;
}

export default function PrivacyMeter({ n, title, detail }: Props) {
  const lvl = n === null ? null : privacyLevel(n);
  return (
    <div className={`privacy-meter level-${lvl?.level ?? "loading"}`} role="group" aria-label={`${title}: ${lvl ? lvl.label : "checking"}`}>
      <div className="privacy-meter-head">
        <span>{title}</span>
        <strong>{lvl ? lvl.label : "Checking…"}</strong>
      </div>
      <div className="privacy-meter-bar" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <span key={i} className={lvl && i <= lvl.level ? "on" : ""} />)}
      </div>
      <p>{detail}</p>
    </div>
  );
}
