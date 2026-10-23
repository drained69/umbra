// Umbra for native Portaldot accounts (Portaldot Extension / any sr25519-ed25519 signer).
// The user never needs an EVM wallet: their 5… account calls Umbra's EVM contracts through
// pallet-revive. Reads still go through the EVM RPC (UmbraPoolClient); writes are
// dry-run-estimated `revive.call` extrinsics signed by the native account.

import type { ApiPromise } from "@polkadot/api";
import { ethers } from "ethers";
import { ERC20_ABI, POOL_ABI, POOL_ERRORS_ABI } from "./abi";
import type { Note } from "./note";
import type { UmbraPoolClient } from "./client";
import { buildReviveCall, evmAddressOf, isMapped, sendNative, type SendResult } from "./portaldot";

const ERC20 = new ethers.Interface(ERC20_ABI);
const POOL_AND_ERRORS = [...POOL_ABI, ...POOL_ERRORS_ABI];

export class UmbraNative {
  constructor(
    readonly api: ApiPromise,
    /** SS58 address of the native account */
    readonly account: string,
    /** { signer } from the Portaldot Extension, or { pair } (KeyringPair) in Node/tests */
    readonly auth: { signer?: any; pair?: any }
  ) {}

  /** The account's EVM identity (msg.sender inside Umbra's contracts). */
  evmAddress(): Promise<string> {
    return evmAddressOf(this.api, this.account);
  }

  isMapped(): Promise<boolean> {
    return isMapped(this.api, this.account);
  }

  /**
   * Shield one note from the native account.
   *  - tPOT pools: one transaction (`revive.mapAccount` is batched in automatically the
   *    first time) — msg.value arrives as planck × 10^4 (18-dec), exactly the pool unit.
   *  - asset pools (pUSD…): if the allowance is short, an `approve` transaction first, then
   *    the deposit. Each call carries limits from a live dry-run.
   */
  async deposit(pool: UmbraPoolClient, note: Note, memo?: Uint8Array): Promise<SendResult[]> {
    const denom = await pool.denomination();
    if (note.denomination !== denom) throw new Error("note denomination does not match this pool");
    const token = await pool.token();
    const data = pool.depositCalldata(note, memo);
    const results: SendResult[] = [];

    if (token !== ethers.ZeroAddress) {
      const owner = await this.evmAddress();
      const reader = new ethers.Contract(token, ERC20_ABI, (pool as any).provider);
      if ((await reader.allowance(owner, pool.address)) < denom) {
        const approve = await buildReviveCall(
          this.api,
          this.account,
          token,
          ERC20.encodeFunctionData("approve", [pool.address, denom]),
          0n,
          { abi: ERC20_ABI }
        );
        results.push(await sendNative(this.api, this.account, [approve], this.auth));
      }
    }

    const value = token === ethers.ZeroAddress ? denom : 0n;
    const call = await buildReviveCall(this.api, this.account, pool.address, data, value, { abi: POOL_AND_ERRORS });
    results.push(await sendNative(this.api, this.account, [call], this.auth));
    return results;
  }

  /** Map this account to the EVM (needed before it can RECEIVE withdrawals at its H160). */
  async mapAccount(): Promise<SendResult | null> {
    if (await this.isMapped()) return null;
    return sendNative(this.api, this.account, [], this.auth); // sendNative prepends mapAccount
  }
}
