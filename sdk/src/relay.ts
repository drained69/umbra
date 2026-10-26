// Relayed private-balance transactions: the relayer submits a proven join-split `transact`,
// so the user's wallet never signs or pays gas for it. The relayer address and fee are
// bound into the proof (extDataHash), so it cannot redirect funds or take a larger fee.

import { ethers } from "ethers";
import { UmbraShieldedClient, type RelayTerms } from "./shieldedClient";
import type { ExtData, TransactionProof } from "./transaction";

export interface RelayerQuote extends RelayTerms {
  url: string;
  pool: string;
}

/** Fetch the relayer's terms for the private pool and check they match this deployment. */
export async function getRelayerQuote(url: string, expect: { chainId: number | bigint; pool: string }): Promise<RelayerQuote> {
  const base = url.replace(/\/+$/, "");
  const res = await fetch(`${base}/status`);
  if (!res.ok) throw new Error(`relayer unavailable (${res.status})`);
  const s = await res.json();
  if (BigInt(s.chainId) !== BigInt(expect.chainId)) throw new Error("the relayer is on a different network");
  if (!s.shielded || !ethers.isAddress(s.shielded.pool) || ethers.getAddress(s.shielded.pool) !== ethers.getAddress(expect.pool)) {
    throw new Error("the relayer does not serve this private pool");
  }
  if (!ethers.isAddress(s.relayer)) throw new Error("the relayer returned an invalid address");
  return { url: base, pool: ethers.getAddress(s.shielded.pool), relayer: ethers.getAddress(s.relayer), fee: BigInt(s.shielded.fee) };
}

/** Send a prepared transaction to the relayer; resolves once it is in a block. */
export async function relayTransact(quote: RelayerQuote, prepared: { proof: TransactionProof; ext: ExtData }): Promise<{ txHash: string; blockHash: string }> {
  if (ethers.getAddress(prepared.ext.relayer) !== quote.relayer || prepared.ext.fee < quote.fee) {
    throw new Error("this proof is not bound to the relayer's terms");
  }
  const [args, extData] = UmbraShieldedClient.encodeArgs(prepared.proof, prepared.ext);
  const body = JSON.stringify({ args, extData }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const res = await fetch(`${quote.url}/transact`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ? `relayer: ${j.error}` : `relayer failed (${res.status})`);
  return { txHash: j.txHash, blockHash: j.blockHash };
}
