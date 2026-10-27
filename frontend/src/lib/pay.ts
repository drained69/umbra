import { ethers } from "ethers";
import {
  ERC20_ABI,
  assetErc20Address,
  publicTransferCalls,
  resolveAccount,
  resolveRecipient,
  sendNative,
  toUnits,
  type RequestAsset,
  type UmbraShieldedClient,
  Keypair,
} from "@umbra/sdk";
import { blockLink, getApi, short } from "./chain";
import { NATIVE_PLANCK_DECIMALS, TPOT } from "./finance";
import { spendPrivately, submitShielded, type TxRef } from "./shielded";
import { MA_NATIVE, maClient, maIdFor, proveMulti, spendMulti, submitMultiWithWallet } from "./multi";
import type { Wallet } from "./wallet";

/**
 * Pay a shielded address. "private" spends the payer's private balance: the relayer submits
 * it, so sender, recipient and amount are all hidden (unless `signer` opts to sign with a
 * wallet). "wallet" deposits from the connected wallet straight into the payee's note
 * (recipient hidden, wallet and amount visible as a deposit). The memo is encrypted to the payee.
 */
export async function payPrivately(
  signer: Wallet | null,
  client: UmbraShieldedClient,
  p: { source: "private" | "wallet"; owner: Keypair | null; to: string; amount: string; memo?: string; pool?: "multi" | "legacy"; asset?: RequestAsset },
  onStatus: (m: string) => void
): Promise<TxRef> {
  const asset = p.asset ?? TPOT;
  const id = maIdFor(asset);
  if (id === null) throw new Error(`${asset.symbol} can't be paid privately on this network.`);
  const base = { owner: p.owner, to: p.to, amount: toUnits(p.amount, asset.decimals), memo: p.memo };
  // tokens live only in the multi-asset pool; tPOT may be in either pool
  const multi = id !== MA_NATIVE || p.pool === "multi";
  if (p.source === "private") {
    if (multi) {
      const owner = p.owner!;
      return spendMulti(id, (relay) => maClient!.planPayment({ owner, to: p.to, asset: id, amount: base.amount, memo: p.memo, relay }), onStatus, { selfSubmit: signer });
    }
    return spendPrivately(client, (relay) => client.planPayment({ ...base, source: "private", relay }), onStatus, { selfSubmit: signer });
  }
  if (!signer) throw new Error("Connect a wallet to pay from it.");
  if (maClient) {
    // new deposits go to the multi-asset pool once it exists
    onStatus("Generating a zero-knowledge proof in your browser…");
    const prepared = await proveMulti(maClient.planDeposit(p.owner ?? new Keypair(), id, base.amount, p.to, p.memo));
    return submitMultiWithWallet(signer, prepared, onStatus);
  }
  return submitShielded(signer, client, await client.planPayment({ ...base, source: "wallet" }), onStatus);
}

/**
 * A public transfer to a Portaldot (5…) or 0x address. From a native wallet, a request id is
 * bound into the same extrinsic with `system.remarkWithEvent`, which makes the block hash a
 * verifiable receipt. Returns the block hash for receipts (native wallets only).
 */
export async function payPublicly(
  wallet: Wallet,
  p: { asset: RequestAsset; to: string; amount: string; requestId?: string },
  onStatus: (m: string) => void
): Promise<TxRef & { blockHash?: string }> {
  const api = await getApi();
  if (wallet.kind === "native") {
    const dest = await resolveAccount(api, p.to);
    const units = toUnits(p.amount, p.asset.assetId === null ? NATIVE_PLANCK_DECIMALS : p.asset.decimals);
    const calls = publicTransferCalls(api, { assetId: p.asset.assetId, to: dest, amount: units, requestId: p.requestId });
    onStatus("Sign the payment in the Portaldot Extension…");
    const r = await sendNative(api, wallet.account, calls, { signer: wallet.signer });
    return { label: `block ${short(r.blockHash)}`, href: blockLink(r.blockHash), blockHash: r.blockHash };
  }
  // EVM wallet: native token as msg.value, assets through their ERC-20 precompile.
  let to: string;
  if (ethers.isAddress(p.to.trim())) to = ethers.getAddress(p.to.trim());
  else {
    const r = await resolveRecipient(api, p.to);
    if (!r.receivable) throw new Error(r.note);
    to = r.evmAddress;
  }
  onStatus("Confirm the payment in your wallet…");
  const tx =
    p.asset.assetId === null
      ? await wallet.signer.sendTransaction({ to, value: toUnits(p.amount, 18) })
      : await new ethers.Contract(assetErc20Address(p.asset.assetId), ERC20_ABI, wallet.signer).transfer(to, toUnits(p.amount, p.asset.decimals));
  const receipt = await tx.wait();
  return { label: `EVM tx ${short(receipt.hash)}`, href: blockLink(receipt.blockHash) };
}
