#!/usr/bin/env node
/*
 * Deploy Umbra to a Portaldot network (multi-network).
 *
 *   NETWORK=testnet (default) | mainnet
 *   - RPC/chainId come from networks.json; env MAINNET_EVM_RPC / MAINNET_CHAIN_ID /
 *     PORTALDOT_RPC / PORTALDOT_CHAIN_ID override.
 *   - Deployment is REFUSED on a network whose EVM is not available (e.g. mainnet today),
 *     unless you supply verified EVM params. We never invent chain params.
 *
 * Deploys: Poseidon(2) + WithdrawVerifier + TransactionVerifier (or coprocessor bridge)
 *          + UmbraPoolFactory (fixed pools) + UmbraShieldedPool (join-split engine).
 *
 * Prereqs: `forge build` in contracts/; `npm i` here.
 */
import "dotenv/config";
import { ethers } from "ethers";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import circomlibjs from "circomlibjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "contracts", "out");
const NETWORKS = JSON.parse(readFileSync(join(__dirname, "networks.json"), "utf8"));

const NETWORK = (process.env.NETWORK || "testnet").toLowerCase();
const net = NETWORKS[NETWORK];
if (!net) throw new Error(`unknown NETWORK: ${NETWORK}`);

const RPC =
  process.env.PORTALDOT_RPC ||
  (NETWORK === "mainnet" ? process.env.MAINNET_EVM_RPC : null) ||
  net.evmRpc;
const CHAIN_ID = Number(
  process.env.PORTALDOT_CHAIN_ID ||
    (NETWORK === "mainnet" ? process.env.MAINNET_CHAIN_ID : null) ||
    net.chainId ||
    0
);
const DECIMALS = BigInt(process.env.POT_DECIMALS || net.decimals);
const LEVELS = Number(process.env.TREE_LEVELS || 20);
const MODE = (process.env.VERIFIER_MODE || "onchain").toLowerCase();
const DENOMS = (process.env.DENOMINATIONS || "1,10,100").split(",").map((s) => s.trim());

function requireEvmAvailable() {
  if (!RPC || !CHAIN_ID) {
    throw new Error(
      `Network '${NETWORK}' has no verified EVM endpoint.\n${net.note}\n` +
        `Set MAINNET_EVM_RPC + MAINNET_CHAIN_ID (verified via eth_chainId) to deploy there.`
    );
  }
}

function artifact(name, file) {
  const j = JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
async function deploy(wallet, art, args = []) {
  const f = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c;
}

async function main() {
  requireEvmAvailable();
  if (!process.env.PRIVATE_KEY) throw new Error("set PRIVATE_KEY in .env");

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
  // Safety: confirm the chain actually reports the expected id before any tx.
  const live = Number((await provider.getNetwork()).chainId);
  if (live !== CHAIN_ID) throw new Error(`chainId mismatch: RPC reports ${live}, expected ${CHAIN_ID}`);

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`network : ${net.name} (chain ${CHAIN_ID})`);
  console.log(`deployer: ${wallet.address}`);
  console.log(`balance : ${ethers.formatUnits(await provider.getBalance(wallet.address), DECIMALS)} POT`);

  // 1. Poseidon(2)
  const poseidon = await (async () => {
    const f = new ethers.ContractFactory(
      circomlibjs.poseidonContract.generateABI(2),
      circomlibjs.poseidonContract.createCode(2),
      wallet
    );
    const c = await f.deploy();
    await c.waitForDeployment();
    return c;
  })();
  const hasher = await poseidon.getAddress();
  console.log(`Poseidon: ${hasher}`);

  // 2. Verifiers (on-chain or coprocessor bridge)
  let withdrawVerifier, txVerifier;
  if (MODE === "coprocessor") {
    const mk = async () =>
      (await deploy(wallet, artifact("UmbraCoprocessorBridge", "UmbraCoprocessorBridge"), [
        process.env.COPROCESSOR_ADDRESS || ethers.ZeroAddress,
        process.env.ATTESTOR_ADDRESS || wallet.address,
      ])).getAddress();
    withdrawVerifier = await mk();
    txVerifier = await mk();
  } else {
    withdrawVerifier = await (await deploy(wallet, artifact("WithdrawVerifier", "verifiers/WithdrawVerifier"))).getAddress();
    txVerifier = await (await deploy(wallet, artifact("TransactionVerifier", "verifiers/TransactionVerifier"))).getAddress();
  }
  console.log(`WithdrawVerifier: ${withdrawVerifier}`);
  console.log(`TransactionVerifier: ${txVerifier}`);

  // 3. Fixed-denomination factory + pools
  const factory = await deploy(wallet, artifact("UmbraPoolFactory", "UmbraPoolFactory"), [withdrawVerifier, hasher, LEVELS]);
  const factoryAddr = await factory.getAddress();
  const pools = {};
  for (const d of DENOMS) {
    const denomWei = ethers.parseUnits(d, DECIMALS);
    await (await factory.createPool(denomWei)).wait();
    pools[d] = await factory.poolForDenomination(denomWei);
    console.log(`fixed pool ${d} POT: ${pools[d]}`);
  }

  // 4. Join-split shielded pool (the shared engine)
  const shielded = await deploy(wallet, artifact("UmbraShieldedPool", "UmbraShieldedPool"), [txVerifier, hasher, LEVELS]);
  const shieldedAddr = await shielded.getAddress();
  console.log(`shielded pool (join-split): ${shieldedAddr}`);

  const deployment = {
    network: net.name,
    chainId: CHAIN_ID,
    rpc: RPC,
    decimals: Number(DECIMALS),
    verifierMode: MODE,
    treeLevels: LEVELS,
    relayerFeeBps: Number(process.env.RELAYER_FEE_BPS || 50),
    contracts: {
      poseidon: hasher,
      withdrawVerifier,
      transactionVerifier: txVerifier,
      verifier: withdrawVerifier, // back-compat for fixed-pool frontend
      factory: factoryAddr,
      pools,
      shieldedPool: shieldedAddr,
    },
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
  };
  for (const p of [join(ROOT, "deployments", `${NETWORK}.json`), join(ROOT, "frontend", "src", "config", "deployment.json")]) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(deployment, null, 2));
  }
  console.log(`\nwrote deployments/${NETWORK}.json + frontend config. done.`);
}

main().catch((e) => {
  console.error("\n" + (e?.message || e));
  process.exit(1);
});
