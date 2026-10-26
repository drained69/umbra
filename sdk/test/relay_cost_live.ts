/*
 * Measures what one relayed join-split `transact` costs on Portaldot V3 testnet, so the
 * relayer's fee floor is measured rather than guessed. Builds a real (zero-value) proof and
 * dry-runs it; nothing is signed or sent. Read-only:
 *   cd sdk && npx --yes tsx@4.19.1 test/relay_cost_live.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { ethers } from "ethers";
import { join } from "node:path";
import { HybridProvider, Keypair, UmbraShieldedClient, Utxo, dryRunCall, SHIELDED_POOL_ABI } from "../src/index";

const RPC = "https://test-evm-rpc-v3.portaldot.dev";
const WS = "wss://test-node-v3.portaldot.dev";
const CHAIN_ID = 420420777;
const POOL = "0x499298029680abB438bBABd39461805b8EA86d45";
const DEPLOY_BLOCK = 169320;
const ORIGIN_NATIVE = "5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8";
const ORIGIN_EVM = "0x25a1F91BC0bBd2c87AbDF6fcDDabFACe5B69BAA7";
const ART = join(import.meta.dirname, "..", "artifacts");

let apiP: Promise<ApiPromise> | null = null;
const getApi = () => (apiP ??= ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true }));
try {
  const provider = new HybridProvider(RPC, CHAIN_ID, getApi);
  const client = new UmbraShieldedClient(POOL, provider, { deployBlock: DEPLOY_BLOCK, chunkSize: 1_000_000 });
  const owner = new Keypair();
  const t0 = Date.now();
  const { proof, ext } = await client.prepare({
    inputs: [],
    outputs: [new Utxo({ amount: 0n, keypair: owner })],
    owner,
    artifacts: { wasm: join(ART, "transaction.wasm"), zkey: join(ART, "transaction_final.zkey") },
  });
  console.log(`proof built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const [args, extData] = UmbraShieldedClient.encodeArgs(proof, ext);
  const data = new ethers.Interface(SHIELDED_POOL_ABI).encodeFunctionData("transact", [args, extData]);

  const dr = await dryRunCall(await getApi(), ORIGIN_NATIVE, POOL, data);
  console.log("native dry-run:", { ok: dr.ok, error: dr.error, storageDepositTpot: Number(dr.storageDeposit) / 1e14, weight: dr.weightRequired });

  const evm = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const gas = await evm.estimateGas({ from: ORIGIN_EVM, to: POOL, data });
  const { gasPrice } = await evm.getFeeData();
  console.log("evm estimate:", { gas: gas.toString(), gasPrice: gasPrice?.toString(), costTpot: Number(gas * (gasPrice ?? 0n)) / 1e18 });
} finally {
  if (apiP) await (await apiP).disconnect();
}
