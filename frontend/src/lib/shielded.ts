import { ethers } from "ethers";
import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { SHIELDED_POOL_ABI, UmbraShieldedClient, buildReviveCall, relayTransact, sendNative, type RelayTerms, type TransactParams } from "@umbra/sdk";
import { DEPLOYMENT, blockLink, getApi, short } from "./chain";
import { relayerQuote } from "./relay";
import type { Wallet } from "./wallet";

export const TX_ARTIFACTS = { wasm: "/zk/transaction.wasm", zkey: "/zk/transaction_final.zkey" };
export const SHIELDED_POOL = DEPLOYMENT.contracts.shieldedPool as string;
const POOL = new ethers.Interface(SHIELDED_POOL_ABI);

export interface TxRef {
  label: string;
  href?: string;
}

type Plan = Omit<TransactParams, "artifacts">;

/** Prove a join-split plan in the browser (scans commitments, checks the root on chain). */
export function proveShielded(client: UmbraShieldedClient, plan: Plan) {
  return client.prepare({ ...plan, artifacts: TX_ARTIFACTS });
}

/** A proven `transact` as a `revive.call`, for batching with other calls under one signature. */
export async function shieldedCall(
  account: string,
  prepared: Awaited<ReturnType<typeof proveShielded>>,
  opts: { dependsOnEarlierCalls?: boolean } = {}
): Promise<SubmittableExtrinsic<"promise">> {
  const api = await getApi();
  const [args, extData] = UmbraShieldedClient.encodeArgs(prepared.proof, prepared.ext);
  const value = prepared.ext.extAmount > 0n ? prepared.ext.extAmount : 0n;
  return buildReviveCall(api, account, SHIELDED_POOL, POOL.encodeFunctionData("transact", [args, extData]), value, {
    abi: SHIELDED_POOL_ABI,
    // a deposit funded by an earlier call in the same batch cannot be dry-run on its own
    fallbackWeight: opts.dependsOnEarlierCalls ? { refTime: 300_000_000_000n, proofSize: 2_000_000n } : undefined,
    // two new nullifier slots cost 7.68 tPOT of storage deposit (measured); cap at 12
    fallbackDeposit: 12n * 10n ** 14n,
  });
}

/**
 * Spend from the private balance. By default the relayer submits it, so no wallet signs and
 * the chain shows only the relayer; its fee comes out of the private balance. `selfSubmit`
 * (an explicit user choice) signs with the connected wallet instead, which reveals the account.
 */
export async function spendPrivately(
  client: UmbraShieldedClient,
  build: (relay?: RelayTerms) => Promise<Plan>,
  onStatus: (m: string) => void,
  opts: { selfSubmit?: Wallet | null } = {}
): Promise<TxRef> {
  if (opts.selfSubmit) return submitShielded(opts.selfSubmit, client, await build(), onStatus);
  onStatus("Contacting the relayer…");
  const quote = await relayerQuote();
  const plan = await build(quote);
  onStatus("Generating a zero-knowledge proof in your browser…");
  const prepared = await proveShielded(client, plan);
  onStatus("The relayer is submitting it. Nothing for your wallet to sign…");
  const r = await relayTransact(quote, prepared);
  return { label: `relayed · block ${short(r.blockHash)}`, href: blockLink(r.blockHash) };
}

/** Prove and submit a join-split plan with whichever wallet is connected. */
export async function submitShielded(wallet: Wallet, client: UmbraShieldedClient, plan: Plan, onStatus: (m: string) => void): Promise<TxRef> {
  onStatus("Generating a zero-knowledge proof in your browser…");
  const prepared = await proveShielded(client, plan);
  if (wallet.kind === "evm") {
    const [args, extData] = UmbraShieldedClient.encodeArgs(prepared.proof, prepared.ext);
    const contract = new ethers.Contract(SHIELDED_POOL, SHIELDED_POOL_ABI, wallet.signer);
    onStatus("Confirm the transaction in your wallet…");
    const tx = await contract.transact(args, extData, { value: prepared.ext.extAmount > 0n ? prepared.ext.extAmount : 0n });
    const receipt = await tx.wait();
    return { label: `EVM tx ${short(receipt.hash)}`, href: blockLink(receipt.blockHash) };
  }
  const call = await shieldedCall(wallet.account, prepared);
  onStatus("Sign the transaction in the Portaldot Extension…");
  const r = await sendNative(await getApi(), wallet.account, [call], { signer: wallet.signer });
  return { label: `block ${short(r.blockHash)}`, href: blockLink(r.blockHash) };
}
