#!/usr/bin/env node
/*
 * Preflight: verify a Portaldot network can run Umbra BEFORE deploying.
 *
 *   NETWORK=testnet npm run preflight
 *
 * Checks (all read-only):
 *   1. eth_chainId matches networks.json, blocks are advancing
 *   2. BN254 precompiles 0x06 (ecAdd), 0x07 (ecMul), 0x08 (ecPairing) return correct values
 *      -> required by the on-chain Groth16 verifiers
 *   3. Raw EVM bytecode executes (the circomlibjs Poseidon is hand-assembled bytecode)
 *   4. PUSH0 support (informational; contracts target `paris` and don't need it)
 *   5. Native token decimals (Substrate) and the EVM/native value ratio (must be 10^4 for
 *      the 18-dec EVM unit assumption) — uses PREFLIGHT_ADDRESS or the deployer if set.
 */
import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { blake2b } from "@noble/hashes/blake2b";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NETWORKS = JSON.parse(readFileSync(join(__dirname, "networks.json"), "utf8"));
const NETWORK = (process.env.NETWORK || "testnet").toLowerCase();
const net = NETWORKS[NETWORK];

let failures = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ✘ ${m}`);
};

const G1 = "0".repeat(63) + "1" + "0".repeat(63) + "2"; // generator (1,2)
const TWO_G =
  "030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd315ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4";

async function substrate(method, params = []) {
  const url = net.substrateWs.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

async function main() {
  console.log(`Preflight: ${NETWORK}`);
  const rpc = process.env.PORTALDOT_RPC || net.evmRpc;
  if (!rpc) {
    bad(`no EVM RPC for '${NETWORK}' — ${net.note}`);
    process.exit(1);
  }
  const p = new ethers.JsonRpcProvider(rpc);

  // 1. chain id + liveness
  const id = Number((await p.getNetwork()).chainId);
  id === net.chainId ? ok(`chainId ${id}`) : bad(`chainId ${id} != expected ${net.chainId}`);
  const b1 = await p.getBlockNumber();
  await new Promise((r) => setTimeout(r, 7000));
  const b2 = await p.getBlockNumber();
  b2 > b1 ? ok(`blocks advancing (${b1} -> ${b2})`) : bad(`chain not producing blocks (${b1})`);

  // 2. BN254 precompiles
  const add = await p.call({ to: "0x0000000000000000000000000000000000000006", data: "0x" + G1 + G1 });
  add.slice(2) === TWO_G ? ok("ecAdd (0x06)") : bad(`ecAdd wrong: ${add}`);
  const mul = await p.call({ to: "0x0000000000000000000000000000000000000007", data: "0x" + G1 + "0".repeat(63) + "2" });
  mul.slice(2) === TWO_G ? ok("ecMul (0x07)") : bad(`ecMul wrong: ${mul}`);
  const pair = await p.call({ to: "0x0000000000000000000000000000000000000008", data: "0x" });
  BigInt(pair) === 1n ? ok("ecPairing (0x08)") : bad(`ecPairing wrong: ${pair}`);

  // 3. raw EVM bytecode (initcode returning runtime 602a60005260206000f3)
  const created = await p.call({ data: "0x600a600c600039600a6000f3602a60005260206000f3" });
  created === "0x602a60005260206000f3" ? ok("raw EVM bytecode executes") : bad(`raw bytecode: ${created}`);

  // 4. PUSH0 (informational)
  try {
    await p.call({ data: "0x5f5f5260205ff3" });
    ok("PUSH0 supported (contracts target paris anyway)");
  } catch {
    console.log("  • PUSH0 unsupported (fine: contracts target paris)");
  }

  // 5. units
  const props = await substrate("system_properties");
  const nativeDec = Number(props?.tokenDecimals);
  nativeDec === net.nativeDecimals
    ? ok(`native tokenDecimals ${nativeDec} (${props?.tokenSymbol})`)
    : bad(`native decimals ${nativeDec} != ${net.nativeDecimals}`);

  const addr =
    process.env.PREFLIGHT_ADDRESS ||
    (process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY).address : null);
  if (!addr) {
    console.log("  • set PREFLIGHT_ADDRESS (a funded address) to check the EVM/native ratio");
  } else {
    // pallet-revive maps H160 -> AccountId32 = H160 ++ 0xEE*12
    const acct = ethers.concat([addr, "0x" + "ee".repeat(12)]);
    const key =
      "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9" +
      Buffer.from(blake2b(ethers.getBytes(acct), { dkLen: 16 })).toString("hex") +
      acct.slice(2);
    const raw = await substrate("state_getStorage", [key]);
    const evmBal = await p.getBalance(addr);
    if (!raw) {
      console.log(`  • ${addr} has no native account; fund it to check the ratio`);
    } else {
      const free = BigInt("0x" + Buffer.from(ethers.getBytes(raw).slice(16, 32).reverse()).toString("hex"));
      const ratio = Number(evmBal) / Number(free);
      const expected = 10 ** (net.evmDecimals - net.nativeDecimals);
      Math.abs(ratio - expected) / expected < 0.01
        ? ok(`EVM/native value ratio ≈ ${ratio.toFixed(1)} (expected ${expected})`)
        : bad(`EVM/native ratio ${ratio} != ${expected} — recheck EVM_DECIMALS`);
    }
  }

  // 6. Substrate-side runtime facts Umbra depends on (pallet-revive + pallet-assets)
  try {
    const { ApiPromise, WsProvider } = await import("@polkadot/api");
    const api = await ApiPromise.create({ provider: new WsProvider(net.substrateWs), noInitWarn: true });
    const rv = api.consts.revive;
    const ratio = BigInt(rv.nativeToEthRatio.toString());
    ratio === 10n ** BigInt(net.evmDecimals - net.nativeDecimals)
      ? ok(`revive.nativeToEthRatio = ${ratio} (EVM ${net.evmDecimals}-dec)`)
      : bad(`revive.nativeToEthRatio = ${ratio}, expected 10^${net.evmDecimals - net.nativeDecimals}`);
    Number(rv.chainId.toString()) === net.chainId ? ok(`revive.chainId = ${rv.chainId}`) : bad(`revive.chainId ${rv.chainId} != ${net.chainId}`);
    rv.allowEVMBytecode.isTrue ? ok("revive.allowEVMBytecode = true (Solidity/EVM bytecode deployable)") : bad("EVM bytecode not allowed");
    const ed = api.consts.balances.existentialDeposit.toBigInt();
    ok(`existential deposit = ${Number(ed) / 10 ** net.nativeDecimals} (fresh recipients need at least this)`);
    console.log(`  • storage price: ${Number(rv.depositPerByte.toBigInt()) / 10 ** net.nativeDecimals}/byte, ${Number(rv.depositPerItem.toBigInt()) / 10 ** net.nativeDecimals}/item — run \`make estimate\` for deploy cost`);
    // configured Portaldot assets: ERC-20 precompile must mirror the native asset
    const specs = (process.env.TOKEN_POOLS ?? "7777:100,1000").split(";").filter(Boolean);
    for (const spec of specs) {
      const id = BigInt(spec.split(":")[0]);
      const a = await api.query.assets.asset(id);
      if (a.isNone) { bad(`asset ${id} does not exist`); continue; }
      const erc20 = ethers.getAddress("0x" + id.toString(16).padStart(8, "0") + "0".repeat(24) + "00010000");
      const supply = BigInt(await p.call({ to: erc20, data: "0x18160ddd" }));
      const md = await api.query.assets.metadata(id);
      supply === a.unwrap().supply.toBigInt()
        ? ok(`asset ${id} (${md.symbol.toUtf8()}) ERC-20 precompile ${erc20} mirrors native supply` + (a.unwrap().isSufficient.isTrue ? "" : " [non-sufficient: recipients must hold tPOT]"))
        : bad(`asset ${id} ERC-20 precompile supply ${supply} != native ${a.unwrap().supply}`);
    }
    await api.disconnect();
  } catch (e) {
    bad(`substrate checks failed: ${e?.message || e}`);
  }

  console.log(failures ? `\n${failures} check(s) FAILED — do not deploy.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
