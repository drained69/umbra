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
import { poseidonContract } from "circomlibjs";

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
// EVM-side unit (pallet-revive scales native 14-dec POT to 18-dec). Audit H-01.
const DECIMALS = BigInt(process.env.EVM_DECIMALS || net.evmDecimals);
const LEVELS = Number(process.env.TREE_LEVELS || 20);
const MODE = (process.env.VERIFIER_MODE || "onchain").toLowerCase();
const DENOMS = (process.env.DENOMINATIONS || "100,1000").split(",").map((s) => s.trim());
// Shielded Portaldot assets: "assetId:denom,denom;assetId:denom" in whole tokens.
// Default shields pUSD (asset 7777) in 100/1000 pUSD pools.
const TOKEN_POOLS = (process.env.TOKEN_POOLS ?? "7777:100,1000")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const [id, denoms] = spec.split(":");
    return { assetId: BigInt(id), denoms: denoms.split(",").map((d) => d.trim()) };
  });

/** Portaldot asset ERC-20 precompile: 0x{assetId:8 hex}{24 zero hex}00010000 (verified live). */
const assetErc20 = (id) => ethers.getAddress("0x" + id.toString(16).padStart(8, "0") + "0".repeat(24) + "00010000");
const ERC20_META = ["function decimals() view returns (uint8)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"];

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
  const deployBlock = await provider.getBlockNumber();

  // 1. Poseidon(2)
  const poseidon = await (async () => {
    const f = new ethers.ContractFactory(
      poseidonContract.generateABI(2),
      poseidonContract.createCode(2),
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
    withdrawVerifier = await (await deploy(wallet, artifact("WithdrawVerifier", "WithdrawVerifier"))).getAddress();
    txVerifier = await (await deploy(wallet, artifact("TransactionVerifier", "TransactionVerifier"))).getAddress();
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

  // 3b. Shielded Portaldot assets (ERC-20 precompiles). On `local`, a mock pUSD stands in.
  const tokens = {};
  const tokenSpecs = NETWORK === "local" ? [{ local: true, denoms: ["10", "100", "1000"] }] : TOKEN_POOLS;
  for (const spec of tokenSpecs) {
    let address, assetId = null;
    if (spec.local) {
      const mock = await deploy(wallet, artifact("MockERC20", "MockERC20"), ["Portaldot USD (local mock)", "pUSD", 6, 0]);
      address = await mock.getAddress();
      await (await mock.mint(wallet.address, 1_000_000n * 10n ** 6n)).wait();
    } else {
      assetId = spec.assetId;
      address = assetErc20(assetId);
    }
    const erc20 = new ethers.Contract(address, ERC20_META, provider);
    const [decimals, symbol, supply] = await Promise.all([erc20.decimals(), erc20.symbol(), erc20.totalSupply()]);
    if (supply === 0n && !spec.local) throw new Error(`asset ${assetId} has no supply / no ERC-20 precompile — check TOKEN_POOLS`);
    const tokenPools = {};
    for (const d of spec.denoms) {
      const denom = ethers.parseUnits(d, decimals);
      await (await factory.createPoolFor(address, denom)).wait();
      tokenPools[d] = await factory.poolFor(address, denom);
      console.log(`fixed pool ${d} ${symbol}: ${tokenPools[d]}`);
    }
    // pallet-assets rules (who can receive / minimum amounts) straight from the runtime
    let sufficient = true, minBalance = "1";
    if (!spec.local) {
      const { ApiPromise, WsProvider } = await import("@polkadot/api");
      const api = await ApiPromise.create({ provider: new WsProvider(net.substrateWs), noInitWarn: true });
      const a = (await api.query.assets.asset(assetId)).unwrap();
      sufficient = a.isSufficient.isTrue;
      minBalance = a.minBalance.toString();
      await api.disconnect();
    }
    tokens[symbol] = { assetId: assetId === null ? null : Number(assetId), address, decimals: Number(decimals), sufficient, minBalance, pools: tokenPools };
  }

  // 4. Join-split shielded pool (the shared engine)
  const shielded = await deploy(wallet, artifact("UmbraShieldedPool", "UmbraShieldedPool"), [txVerifier, hasher, LEVELS]);
  const shieldedAddr = await shielded.getAddress();
  console.log(`shielded pool (join-split): ${shieldedAddr}`);

  // 5. Multi-asset private balance (native + the shielded tokens) with private swaps
  const maVerifier = await (await deploy(wallet, artifact("MultiAssetVerifier", "MultiAssetVerifier"))).getAddress();
  const maTokens = Object.values(tokens).map((t) => t.address);
  const ma = await deploy(wallet, artifact("UmbraMultiAssetPool", "UmbraMultiAssetPool"), [maVerifier, hasher, LEVELS, maTokens]);
  const multiAssetPool = {
    address: await ma.getAddress(),
    verifier: maVerifier,
    // asset id -> token; id 0 is the native token
    assets: [{ id: 0, symbol: NETWORK === "testnet" ? "tPOT" : "POT", address: null, decimals: Number(DECIMALS) }].concat(
      Object.entries(tokens).map(([symbol, t], i) => ({ id: i + 1, symbol, address: t.address, assetId: t.assetId, decimals: t.decimals }))
    ),
  };
  console.log(`multi-asset pool: ${multiAssetPool.address}`);

  const deployment = {
    network: net.name,
    chainId: CHAIN_ID,
    rpc: RPC,
    decimals: Number(DECIMALS), // EVM unit (18)
    nativeDecimals: net.nativeDecimals,
    substrateWs: net.substrateWs,
    deployBlock,
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
      tokens,
      shieldedPool: shieldedAddr,
      multiAssetPool,
    },
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
  };
  const targets = [join(ROOT, "deployments", `${NETWORK}.json`)];
  if (process.env.WRITE_FRONTEND_CONFIG !== "0" && NETWORK !== "local") {
    targets.push(join(ROOT, "frontend", "src", "config", "deployment.json"));
  }
  for (const p of targets) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(deployment, null, 2));
  }
  console.log(`\nwrote ${targets.map((t) => t.replace(ROOT + "/", "")).join(" + ")}. done.`);
}

main().catch((e) => {
  console.error("\n" + (e?.message || e));
  process.exit(1);
});
