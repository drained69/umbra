#!/usr/bin/env node
/** Read-only verification of a native Portaldot V3 testnet deployment JSON. */
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRequire = createRequire(join(root, "sdk/package.json"));
const { ethers } = sdkRequire("ethers");
const { ApiPromise, WsProvider } = sdkRequire("@polkadot/api");
const path = resolve(process.argv[2] || join(root, "deployments/testnet.json"));
const expectedNative = process.argv[3];
if (!expectedNative) throw new Error("usage: node scripts/verify-native-deployment.js <deployment.json> <expected 5... account>");
const d = JSON.parse(readFileSync(path, "utf8"));
if (d.network !== "portaldot-v3-testnet" || Number(d.chainId) !== 420420777) throw new Error("deployment JSON is not for Portaldot V3 testnet");
if (d.deployer?.native !== expectedNative) throw new Error("deployment JSON signer differs from the expected account");
const provider = new ethers.JsonRpcProvider("https://test-evm-rpc-v3.portaldot.dev", 420420777);
if (Number((await provider.getNetwork()).chainId) !== 420420777) throw new Error("RPC chain ID mismatch");
const api = await ApiPromise.create({ provider: new WsProvider("wss://test-node-v3.portaldot.dev"), noInitWarn: true });
try {
  const mapped = ethers.getAddress((await api.call.reviveApi.address(expectedNative)).toString());
  if (ethers.getAddress(d.deployer.evm) !== mapped) throw new Error("deployer EVM mapping mismatch");

  const c = d.contracts;
  const required = [c.poseidon, c.withdrawVerifier, c.transactionVerifier, c.shieldedPool,
    c.pools?.["100"], c.pools?.["1000"], c.tokens?.pUSD?.pools?.["100"], c.tokens?.pUSD?.pools?.["1000"]];
  if (required.length !== 8 || required.some((a) => !ethers.isAddress(a) || a === ethers.ZeroAddress)) throw new Error("full eight-contract plan is incomplete");
  if (new Set(required.map((a) => a.toLowerCase())).size !== 8) throw new Error("duplicate contract addresses");
  for (const address of required) {
    const info = await api.query.revive.accountInfoOf(address);
    if (info.isNone) throw new Error(`no deployed contract at ${address}`);
    const kind = info.unwrap().accountType;
    if (!kind.isContract) throw new Error(`${address} is not a contract`);
    console.log(`${address} code ${kind.asContract.codeHash.toString()}`);
  }

  const poolAbi = ["function verifier() view returns(address)", "function hasher() view returns(address)", "function levels() view returns(uint32)", "function denomination() view returns(uint256)", "function token() view returns(address)", "function zeros(uint256) view returns(uint256)"];
  const token = ethers.getAddress("0x00001E6100000000000000000000000000010000");
  for (const [asset, pools, decimals, expectedToken] of [
    ["tPOT", c.pools, 18, ethers.ZeroAddress],
    ["pUSD", c.tokens.pUSD.pools, 6, token],
  ]) {
    for (const amount of ["100", "1000"]) {
      const pool = new ethers.Contract(pools[amount], poolAbi, provider);
      const [verifier, hasher, levels, denomination, actualToken] = await Promise.all([
        pool.verifier(), pool.hasher(), pool.levels(), pool.denomination(), pool.token(),
      ]);
      if (ethers.getAddress(verifier) !== ethers.getAddress(c.withdrawVerifier) ||
          ethers.getAddress(hasher) !== ethers.getAddress(c.poseidon) || Number(levels) !== 20 ||
          BigInt(denomination) !== ethers.parseUnits(amount, decimals) ||
          ethers.getAddress(actualToken) !== expectedToken) throw new Error(`${amount} ${asset} pool wiring mismatch`);
      console.log(`${amount} ${asset} pool wiring OK`);
    }
  }
  const shielded = new ethers.Contract(c.shieldedPool, poolAbi, provider);
  if (ethers.getAddress(await shielded.verifier()) !== ethers.getAddress(c.transactionVerifier) ||
      ethers.getAddress(await shielded.hasher()) !== ethers.getAddress(c.poseidon) ||
      Number(await shielded.levels()) !== 20) throw new Error("join-split pool wiring mismatch");

  const fixed = new ethers.Contract(c.pools["100"], poolAbi, provider);
  const zero = await fixed.zeros(0), next = await fixed.zeros(1);
  const hasher = new ethers.Contract(c.poseidon, ["function poseidon(uint256[2]) view returns(uint256)"], provider);
  if (BigInt(await hasher.poseidon([zero, zero])) !== BigInt(next)) throw new Error("Poseidon zero-hash check failed");

  for (const [label, address, fixture, size] of [
    ["withdraw", c.withdrawVerifier, "proof.json", 6],
    ["join-split", c.transactionVerifier, "tx_proof.json", 7],
  ]) {
    const p = JSON.parse(readFileSync(join(root, "contracts/test/fixtures", fixture), "utf8"));
    const b = [[p.bFlat[0], p.bFlat[1]], [p.bFlat[2], p.bFlat[3]]];
    if (p.pub.length !== size) throw new Error(`${label} fixture has the wrong public-signal length`);
    const verifier = new ethers.Contract(address, ["function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[]) view returns(bool)"], provider);
    if (!(await verifier.verifyProof(p.aFlat, b, p.cFlat, p.pub))) throw new Error(`${label} real-proof verification failed`);
    console.log(`${label} real-proof verification OK`);
  }
  console.log(`Verified eight contracts for ${expectedNative} on Portaldot V3 testnet.`);

  if (d.crossVm) await verifyCrossVm(d.crossVm, c);
} finally {
  await api.disconnect();
}

/** WASM-verified pools: coprocessor code, real-proof checks in the WASM VM, bridge and pool wiring. */
async function verifyCrossVm(x, c) {
  const art = JSON.parse(readFileSync(join(root, "sdk/artifacts/coprocessor.json"), "utf8"));
  const info = await api.query.contracts.contractInfoOf(x.coprocessor);
  if (info.isNone) throw new Error(`no WASM contract at ${x.coprocessor}`);
  const codeHash = info.unwrap().codeHash.toHex();
  if (codeHash !== art.codeHash || codeHash !== x.coprocessorCodeHash) throw new Error("coprocessor code hash differs from the pinned artifact");
  console.log(`${x.coprocessor} WASM code ${codeHash}`);

  // ink! 5 call data: selector | a | b | c (raw words) | Vec<word> (compact length + words)
  const W = (v) => ethers.zeroPadValue(ethers.toBeHex(BigInt(v)), 32);
  const p = JSON.parse(readFileSync(join(root, "contracts/test/fixtures/proof.json"), "utf8"));
  const message = (label, inputs) => ethers.concat([art.selectors[label], ...p.aFlat.map(W), ...p.bFlat.map(W), ...p.cFlat.map(W),
    api.createType("Compact<u32>", inputs.length).toU8a(), ...inputs.map(W)]);
  const wasmCall = async (data) => {
    const r = await api.call.contractsApi.call(expectedNative, x.coprocessor, 0, null, null, data);
    if (r.result.isErr) throw new Error(`WASM call failed: ${r.result.asErr.toString()}`);
    return { data: r.result.asOk.data.toHex(), refTime: BigInt(r.gasRequired.refTime.toString()) };
  };
  const ok = await wasmCall(message("check", p.pub)); // Ok(Ok(true)) = 00 00 01
  if (ok.data !== "0x000001") throw new Error(`WASM VM did not accept the real withdraw proof (${ok.data})`);
  console.log(`withdraw real-proof verification in the WASM VM OK (${(Number(ok.refTime) / 1e12).toFixed(3)} s of block weight)`);
  const tampered = [...p.pub];
  tampered[4] = "1"; // the relayer fee
  if ((await wasmCall(message("check", tampered))).data !== "0x000000") throw new Error("WASM VM accepted a tampered proof");
  console.log("tampered proof rejected in the WASM VM OK");
  const count = await wasmCall(art.selectors.verify_count); // Ok(u64 little-endian)
  console.log(`on-chain WASM verifications so far: ${api.createType("u64", ethers.dataSlice(count.data, 1)).toString()}`);

  const bridge = new ethers.Contract(x.bridge, ["function attestor() view returns(address)", "function coprocessor() view returns(address)",
    "function verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[]) view returns(bool)"], provider);
  if (ethers.getAddress(await bridge.attestor()) !== ethers.getAddress(x.attestor) || (await bridge.coprocessor()) !== ethers.ZeroAddress) {
    throw new Error("bridge attestor or coprocessor mismatch");
  }
  if (await bridge.verifyProof(p.aFlat, [[p.bFlat[0], p.bFlat[1]], [p.bFlat[2], p.bFlat[3]]], p.cFlat, p.pub)) {
    throw new Error("bridge accepts a proof nobody attested");
  }
  console.log(`bridge ${x.bridge} wiring OK (attestor ${x.attestor}; unattested proofs rejected)`);

  const poolAbi = ["function verifier() view returns(address)", "function hasher() view returns(address)", "function levels() view returns(uint32)",
    "function denomination() view returns(uint256)", "function token() view returns(address)"];
  for (const [amount, address] of Object.entries(x.pools)) {
    const pool = new ethers.Contract(address, poolAbi, provider);
    const [verifier, hasher, levels, denomination, token] = await Promise.all([pool.verifier(), pool.hasher(), pool.levels(), pool.denomination(), pool.token()]);
    if (ethers.getAddress(verifier) !== ethers.getAddress(x.bridge) || ethers.getAddress(hasher) !== ethers.getAddress(c.poseidon) ||
        Number(levels) !== 20 || BigInt(denomination) !== ethers.parseUnits(amount, 18) || token !== ethers.ZeroAddress) {
      throw new Error(`${amount} tPOT WASM-verified pool wiring mismatch`);
    }
    console.log(`${amount} tPOT WASM-verified pool wiring OK`);
  }
  console.log("Verified the cross-VM (WASM) verification path.");
}
