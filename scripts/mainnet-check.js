#!/usr/bin/env node
/*
 * Mainnet (or any network) suitability check — READ-ONLY, Substrate-only (works without an
 * EVM RPC, as on PortaldotV3 Live). Everything runs as runtime dry-runs; nothing is signed.
 *
 *   NETWORK=v3live node scripts/mainnet-check.js
 *
 * Checks: runtime constants Umbra depends on, BN254 precompiles, REAL Groth16 proofs for both
 * circuits verifying inside the runtime, full deployment dry-run, asset ERC-20 precompiles.
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NETWORK = (process.env.NETWORK || "v3live").toLowerCase();
const net = JSON.parse(readFileSync(join(__dirname, "networks.json"), "utf8"))[NETWORK];
const art = (n) => JSON.parse(readFileSync(join(ROOT, "contracts", "out", `${n}.sol`, `${n}.json`), "utf8")).bytecode.object;
const fixture = (f) => JSON.parse(readFileSync(join(ROOT, "contracts", "test", "fixtures", f), "utf8"));
const coder = ethers.AbiCoder.defaultAbiCoder();

let failures = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => (failures++, console.log(`  ✘ ${m}`));

const api = await ApiPromise.create({ provider: new WsProvider(net.substrateWs), noInitWarn: true });
const chain = (await api.rpc.system.chain()).toString();
console.log(`Suitability: ${chain} (${api.runtimeVersion.specName} ${api.runtimeVersion.specVersion}) via ${net.substrateWs}\n`);
const entries = await api.query.system.account.entries();
const origin = entries.sort((a, b) => (b[1].data.free.toBigInt() > a[1].data.free.toBigInt() ? 1 : -1))[0][0].args[0].toString();

// runtime constants
const rv = api.consts.revive;
rv.allowEVMBytecode.isTrue ? ok("pallet-revive accepts EVM bytecode") : bad("EVM bytecode not allowed");
rv.nativeToEthRatio.toString() === "10000" ? ok("nativeToEthRatio = 10^4 (18-dec EVM units)") : bad(`nativeToEthRatio ${rv.nativeToEthRatio}`);
Number(rv.chainId.toString()) === net.chainId ? ok(`revive.chainId = ${rv.chainId}`) : bad(`revive.chainId ${rv.chainId} != ${net.chainId}`);
const hasRpc = (await api.rpc.rpc.methods()).methods.some((m) => m.toString().startsWith("eth_"));
console.log(`  • EVM JSON-RPC on node: ${hasRpc ? "yes" : "NO — Umbra uses its Substrate-native provider (ReviveProvider) instead"}`);

// BN254 precompiles via native dry-run calls
const call = async (to, data) => {
  const r = await api.call.reviveApi.call(origin, to, 0, null, null, data);
  return r.result.isOk ? r.result.asOk.data.toHex() : null;
};
const G1 = "0".repeat(63) + "1" + "0".repeat(63) + "2";
const TWO_G = "030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd315ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4";
(await call("0x0000000000000000000000000000000000000006", "0x" + G1 + G1))?.slice(2) === TWO_G ? ok("ecAdd precompile") : bad("ecAdd");
(await call("0x0000000000000000000000000000000000000007", "0x" + G1 + "0".repeat(63) + "2"))?.slice(2) === TWO_G ? ok("ecMul precompile") : bad("ecMul");
BigInt((await call("0x0000000000000000000000000000000000000008", "0x")) ?? "0x0") === 1n ? ok("ecPairing precompile") : bad("ecPairing");

// REAL proofs verify inside the runtime
for (const [label, verifier, file] of [["withdraw", "WithdrawVerifier", "proof.json"], ["join-split", "TransactionVerifier", "tx_proof.json"]]) {
  const f = fixture(file);
  const a = f.aFlat, b = [[f.bFlat[0], f.bFlat[1]], [f.bFlat[2], f.bFlat[3]]], c = f.cFlat;
  const run = async (pub) => {
    const init = ethers.concat([art("VerifyHarness"), coder.encode(["bytes", "uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[]"], [art(verifier), a, b, c, pub])]);
    const r = await api.call.reviveApi.instantiate(origin, 0, null, null, { Upload: init }, "0x", null);
    return r.result.isOk ? BigInt(r.result.asOk.result.data.toHex()) : null;
  };
  const good = await run(f.pub);
  const tampered = [...f.pub];
  tampered[1] = (BigInt(tampered[1]) ^ 1n).toString();
  const evil = await run(tampered);
  good === 1n && evil === 0n
    ? ok(`real ${label} Groth16 proof verifies in the runtime; tampered input rejected`)
    : bad(`${label} proof: valid=${good} tampered=${evil}`);
}

// full deployment dry-run
const P = (await import("circomlibjs")).poseidonContract.createCode(2);
const dep = await api.call.reviveApi.instantiate(
  origin, 0, null, null,
  {
    Upload: ethers.concat([
      art("DeployHarness"),
      coder.encode(
        ["bytes", "bytes", "bytes", "bytes", "bytes", "bytes", "uint256[]", "address", "uint256[]"],
        [ethers.hexlify(P), art("WithdrawVerifier"), art("TransactionVerifier"), art("UmbraPool"), art("UmbraTokenPool"), art("UmbraShieldedPool"), [10n ** 20n], ethers.ZeroAddress, []]
      ),
    ]),
  },
  "0x", null
);
dep.result.isOk && !(dep.result.asOk.result.flags.bits.toNumber() & 1)
  ? ok(`full contract set deploys (Poseidon, verifiers, pools, join-split): ${(Number(dep.storageDeposit.asCharge.toBigInt()) / 1e14).toFixed(2)} locked`)
  : bad("deployment dry-run failed");

// Portaldot assets on this network
const assets = await api.query.assets.asset.entries();
const list = [];
for (const [k, v] of assets) {
  const id = BigInt(k.args[0].toString());
  const md = await api.query.assets.metadata(id);
  const erc20 = "0x" + id.toString(16).padStart(8, "0") + "0".repeat(24) + "00010000";
  const ts = await call(erc20, "0x18160ddd");
  const mirrored = ts !== null && BigInt(ts) === v.unwrap().supply.toBigInt();
  list.push(`${md.symbol.toUtf8() || "?"}#${id}${mirrored ? "" : "(!)"}`);
  if (!mirrored) bad(`asset ${id} ERC-20 precompile does not mirror native supply`);
}
console.log(`  • assets on this network: ${list.join(", ") || "none"}`);
const pusd = assets.find(([k]) => k.args[0].toString() === "7777");
pusd ? ok("pUSD (#7777) exists → pUSD pools deployable") : console.log("  • pUSD (#7777) is NOT on this network — deploy tPOT pools only, or pick an asset that exists here (TOKEN_POOLS=…)");

await api.disconnect();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nSuitable: all checks passed.");
process.exit(failures ? 1 : 0);
