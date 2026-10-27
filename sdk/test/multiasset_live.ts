/*
 * Read-only checks of the deployed multi-asset pool on Portaldot V3 testnet: its wiring, and a
 * real Groth16 proof accepted by a dry-run of `transact` (nothing is signed or sent).
 *   cd sdk && npx --yes tsx@4.19.1 test/multiasset_live.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HybridProvider, Keypair, MULTI_ASSET_POOL_ABI, UmbraMultiAssetClient, assetErc20Address, dryRunCall } from "../src/index";

const ROOT = join(import.meta.dirname, "..", "..");
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "testnet.json"), "utf8"));
const MA = dep.contracts.multiAssetPool;
const ART = { wasm: join(ROOT, "sdk/artifacts/multiasset.wasm"), zkey: join(ROOT, "sdk/artifacts/multiasset_final.zkey") };
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};

let apiP: Promise<ApiPromise> | null = null;
const getApi = () => (apiP ??= ApiPromise.create({ provider: new WsProvider(dep.substrateWs), noInitWarn: true }));
try {
  const provider = new HybridProvider(dep.rpc, dep.chainId, getApi);
  const pool = new ethers.Contract(MA.address, [...MULTI_ASSET_POOL_ABI, "function verifier() view returns (address)", "function hasher() view returns (address)", "function levels() view returns (uint32)"], provider);
  check(ethers.getAddress(await pool.verifier()) === ethers.getAddress(MA.verifier), "pool uses the deployed multi-asset verifier");
  check(ethers.getAddress(await pool.hasher()) === ethers.getAddress(dep.contracts.poseidon) && Number(await pool.levels()) === 20, "pool uses the deployed Poseidon hasher and a 20-level tree");
  check(Number(await pool.assetCount()) === 2 && (await pool.assetAddress(0)) === ethers.ZeroAddress && ethers.getAddress(await pool.assetAddress(1)) === assetErc20Address(7777), "assets: 0 = native tPOT, 1 = pUSD #7777");

  // a real proof (zero-value deposit) must pass the on-chain verifier
  const client = new UmbraMultiAssetClient(MA.address, provider, { deployBlock: dep.deployBlock, chunkSize: 1_000_000 });
  const owner = new Keypair();
  const { proof, ext } = await client.prepare({ ...client.planDeposit(owner, 0n, 1n), extAmount: 0n, outputs: [] }, ART);
  const [args, extData] = UmbraMultiAssetClient.encodeArgs(proof, ext);
  const data = new ethers.Interface(MULTI_ASSET_POOL_ABI).encodeFunctionData("transact", [args, extData]);
  const dr = await dryRunCall(await getApi(), dep.deployer.native, MA.address, data);
  check(dr.ok, `a real Groth16 proof is accepted by the deployed pool (dry-run; storage deposit ${(Number(dr.storageDeposit) / 1e14).toFixed(2)} tPOT)`);
  const bad = new ethers.Interface(MULTI_ASSET_POOL_ABI).encodeFunctionData("transact", [{ ...args, publicAsset: 1n }, extData]);
  check(!(await dryRunCall(await getApi(), dep.deployer.native, MA.address, bad)).ok, "the same proof with a changed public input is rejected");
} finally {
  if (apiP) await (await apiP).disconnect();
}
console.log(`\n${n} checks passed`);
