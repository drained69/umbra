/*
 * Live Portaldot V3 integration test — READ-ONLY (dry-runs; nothing is signed or spent).
 *
 *   npx tsx sdk/test/portaldot_live.ts
 *
 * Validates the SDK's native layer against the real runtime: asset<->ERC-20 mapping,
 * account<->H160 mapping, recipient resolution, and dry-run-estimated `revive.call`
 * extrinsics from a native account (success, state-changing, and revert decoding).
 */
import { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { ethers } from "ethers";
import {
  listAssets,
  assetErc20Address,
  assetIdFromErc20,
  evmAddressOf,
  isMapped,
  resolveRecipient,
  dryRunCall,
  buildReviveCall,
  planckToEvmWei,
  ERC20_ABI,
} from "../src/index";

const WS = process.env.PORTALDOT_WS || "wss://test-node-v3.portaldot.dev";
const ERC20 = new ethers.Interface(ERC20_ABI);
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};

await cryptoWaitReady();
const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
console.log(`Live: ${(await api.rpc.system.chain()).toString()} (${api.runtimeVersion.specName} ${api.runtimeVersion.specVersion})`);

check(api.consts.revive.nativeToEthRatio.toString() === "10000", "revive.nativeToEthRatio = 10^4 (18-dec EVM units)");
check(planckToEvmWei(10n ** 14n) === 10n ** 18n, "1 tPOT planck -> 1e18 EVM wei");

// assets
const assets = await listAssets(api);
const pusd = assets.find((a) => a.symbol === "pUSD");
check(!!pusd && pusd.decimals === 6, `listAssets finds pUSD (asset ${pusd?.id}, 6 decimals) among ${assets.length} assets`);
check(assetIdFromErc20(pusd!.erc20) === pusd!.id && assetErc20Address(pusd!.id) === pusd!.erc20, "asset id <-> ERC-20 precompile address round-trips");

// accounts
const funded = (await api.query.sudo.key()).toString(); // a funded, mapped native account
const fresh = new Keyring({ type: "sr25519" }).addFromUri("//umbra-live-" + Date.now()).address;
check(await isMapped(api, funded), "funded native account is mapped (H160 round-trips)");
check(!(await isMapped(api, fresh)), "fresh native account is NOT mapped");
const rFresh = await resolveRecipient(api, fresh);
check(rFresh.kind === "native" && !rFresh.receivable, "resolveRecipient flags an unmapped 5… recipient as not receivable");
const r0x = await resolveRecipient(api, "0x11d9f0ca1da31bb54752bf0f43b7ba51110752b7");
check(r0x.kind === "evm" && r0x.receivable, "resolveRecipient accepts 0x recipients");
const fundedH160 = await evmAddressOf(api, funded);

// native -> EVM contract calls (dry-run)
const bal = await dryRunCall(api, funded, pusd!.erc20, ERC20.encodeFunctionData("balanceOf", [fundedH160]));
check(bal.ok && bal.returnData.length === 66, `native account reads pUSD.balanceOf via revive (= ${BigInt(bal.returnData)})`);

const someSpender = ethers.Wallet.createRandom().address;
const approveData = ERC20.encodeFunctionData("approve", [someSpender, 1_000_000n]);
const ap = await dryRunCall(api, funded, pusd!.erc20, approveData);
check(ap.ok && ap.weightRequired.refTime > 0n, `state-changing call dry-runs (weight ${ap.weightRequired.refTime}, deposit ${ap.storageDeposit})`);

const ext = await buildReviveCall(api, funded, pusd!.erc20, approveData, 0n, { abi: ERC20_ABI });
check(ext.method.section === "revive" && ext.method.method === "call", "buildReviveCall produces a revive.call extrinsic with dry-run limits");
const fee = await ext.paymentInfo(funded);
check(fee.partialFee.toBigInt() > 0n, `fee estimate for the native call: ${Number(fee.partialFee.toBigInt()) / 1e14} tPOT`);

const tooMuch = ERC20.encodeFunctionData("approve", [someSpender, 1n]); // ok
void tooMuch;
let threw = "";
try {
  // transfer more pUSD than the account holds -> must revert and be reported, not submitted
  await buildReviveCall(api, funded, pusd!.erc20, new ethers.Interface(["function transfer(address,uint256)"]).encodeFunctionData("transfer", [someSpender, 10n ** 30n]), 0n, { abi: ERC20_ABI });
} catch (e: any) {
  threw = e.message;
}
check(threw.startsWith("call would fail"), `reverting call is caught before signing ("${threw.slice(0, 60)}…")`);

// value transfer semantics: native value -> contract sees 18-dec wei
const r: any = await (api.call as any).reviveApi.instantiate(funded, 10n ** 14n, null, null, { Upload: "0x345f5260205ff3" }, "0x", null);
check(BigInt(r.result.asOk.result.data.toHex()) === 10n ** 18n, "native value 1 tPOT arrives as msg.value = 1e18");

await api.disconnect();
console.log(`\nPORTALDOT LIVE PASSED: ${n} checks`);
process.exit(0);
