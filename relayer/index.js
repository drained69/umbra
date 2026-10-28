#!/usr/bin/env node
/*
 * Umbra relayer.
 *
 * Submits proven transactions so the user's wallet never appears on chain: fixed-pool
 * withdrawals (/withdraw) and private-balance payments and withdrawals (/transact). The
 * relayer pays gas and receives a fee that is BOUND INTO THE PROOF (it cannot redirect funds
 * or raise its fee). Liveness-only trust: users can always submit themselves.
 *
 * Hardening (audit M-02): pool allowlist, strict input validation, body-size + per-IP rate
 * limits, in-flight nullifier lock (no double gas burn), local proof pre-check, optional
 * gas-profitability guard, generic client errors (details only in server logs), and a
 * fail-closed cross-VM path.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as snarkjs from "snarkjs";
import { crossVmAttest, crossVmEnabled } from "./crossvm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const NETWORK = (process.env.NETWORK || "testnet").toLowerCase();
const deployment = JSON.parse(readFileSync(join(ROOT, "deployments", `${NETWORK}.json`), "utf8"));
const vkey = JSON.parse(readFileSync(join(ROOT, "sdk", "artifacts", "withdraw_verification_key.json"), "utf8"));
const txVkey = JSON.parse(readFileSync(join(ROOT, "sdk", "artifacts", "transaction_verification_key.json"), "utf8"));
const maVkey = JSON.parse(readFileSync(join(ROOT, "sdk", "artifacts", "multiasset_verification_key.json"), "utf8"));

const RPC = process.env.PORTALDOT_RPC || deployment.rpc;
const CHAIN_ID = Number(deployment.chainId);
const FEE_BPS = BigInt(process.env.RELAYER_FEE_BPS || deployment.relayerFeeBps || 50);
const PORT = Number(process.env.RELAYER_PORT || 8787);
const RATE_PER_MIN = Number(process.env.RELAYER_RATE_PER_MIN || 10);
const ENFORCE_PROFIT = process.env.RELAYER_ENFORCE_PROFIT === "1";
const CORS_ORIGIN = process.env.RELAYER_CORS_ORIGIN || "*";
// Fee floor: on Portaldot every relayed withdrawal locks a new nullifier storage slot
// (~3.84 tPOT, measured on the live runtime) plus gas, paid by the relayer. The quoted fee
// is max(bps * denomination, floor). Floors are per asset, in whole units.
const IS_LOCAL = deployment.network === "local-anvil";
const MIN_FEE_NATIVE = ethers.parseUnits(process.env.RELAYER_MIN_FEE_NATIVE ?? (IS_LOCAL ? "0" : "4"), 18);
const MIN_FEE_TOKENS = Object.fromEntries(
  (process.env.RELAYER_MIN_FEE_TOKENS || "")
    .split(",")
    .filter(Boolean)
    .map((kv) => kv.split(":").map((x) => x.trim()))
);

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n; // r
const BASE = 21888242871839275222246405745257275088696311157297823662689037894645226208583n; // p

const POOL_ABI = [
  "function denomination() view returns (uint256)",
  "function isSpent(uint256) view returns (bool)",
  "function isKnownRoot(uint256) view returns (bool)",
  "function withdraw(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)",
];

// PRIVATE_KEY (EVM account): fixed-pool withdrawals and the single-asset private pool.
// RELAYER_SEED (native Portaldot account): the multi-asset private pool and private swaps,
// which need the built-in exchange. Set either or both.
if (!process.env.PRIVATE_KEY && !process.env.RELAYER_SEED) throw new Error("set PRIVATE_KEY and/or RELAYER_SEED");
const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY, provider) : null;

// Only pools we deployed can be targeted (prevents gas griefing via arbitrary contracts).
const tokenPools = Object.values(deployment.contracts.tokens || {}).flatMap((t) => Object.values(t.pools));
const ALLOWED_POOLS = new Set([...Object.values(deployment.contracts.pools), ...tokenPools].map((a) => ethers.getAddress(a)));

/** pool address -> { symbol, decimals } for fee floors */
const POOL_ASSET = new Map();
for (const a of Object.values(deployment.contracts.pools)) POOL_ASSET.set(ethers.getAddress(a), { symbol: "tPOT", decimals: 18 });
for (const [symbol, t] of Object.entries(deployment.contracts.tokens || {})) {
  for (const a of Object.values(t.pools)) POOL_ASSET.set(ethers.getAddress(a), { symbol, decimals: t.decimals });
}

/** Fee the relayer will bind into proofs for `pool` (denomination in pool units). */
function feeFor(pool, denom) {
  const asset = POOL_ASSET.get(pool);
  const bpsFee = (denom * FEE_BPS) / 10000n;
  let floor = 0n;
  if (asset?.symbol === "tPOT") floor = MIN_FEE_NATIVE;
  else if (asset && MIN_FEE_TOKENS[asset.symbol]) floor = ethers.parseUnits(MIN_FEE_TOKENS[asset.symbol], asset.decimals);
  const fee = bpsFee > floor ? bpsFee : floor;
  return fee > denom ? denom : fee;
}

/** Quotes for every pool, served on /status so clients bind the exact fee into proofs. */
async function quotes() {
  const out = {};
  for (const a of ALLOWED_POOLS) {
    const denom = await new ethers.Contract(a, ["function denomination() view returns (uint256)"], provider).denomination();
    out[a] = feeFor(a, denom).toString();
  }
  return out;
}
const inFlight = new Set(); // nullifierHash strings currently being relayed

// --- join-split pool (private balance) ---
// The relayer submits private payments and withdrawals so the user's wallet never appears on
// chain. Its fee is paid out of the spent notes and bound into the proof through extDataHash.
const SHIELDED_POOL = deployment.contracts.shieldedPool ? ethers.getAddress(deployment.contracts.shieldedPool) : null;
// Floor per transaction. Measured on the live runtime by sdk/test/relay_cost_live.ts on
// 2026-10-26: 7.68 tPOT storage deposit (two new nullifier slots) + gas = 7.99 tPOT; 9 leaves
// headroom for gas price changes.
const SHIELDED_FEE = ethers.parseUnits(process.env.RELAYER_FEE_SHIELDED ?? (IS_LOCAL ? "0" : "9"), 18);
const SHIELDED_ABI = [
  "function transact((uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 publicAmount,uint256 extDataHash,uint256[2] inputNullifiers,uint256[2] outputCommitments) args,(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2) extData)",
  "function isSpent(uint256) view returns (bool)",
  "function isKnownRoot(uint256) view returns (bool)",
];
const EXT_DATA_TYPE = "tuple(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2)";
const MAX_ENCRYPTED_OUTPUT_BYTES = 1024; // notes are padded to a fixed 384-byte plaintext
const MAX_EXT_AMOUNT = 2n ** 248n;

const MA = deployment.contracts.multiAssetPool || null;
const MA_POOL = MA ? ethers.getAddress(MA.address) : null;
const MA_ASSET_IDS = new Set((MA?.assets || []).map((a) => String(a.id)));
const maRead = MA_POOL ? new ethers.Contract(MA_POOL, ["function isSpent(uint256) view returns (bool)", "function isKnownRoot(uint256) view returns (bool)"], provider) : null;
const native =
  process.env.RELAYER_SEED && MA
    ? await (await import("./native.ts")).startNativeRelayer({ ws: process.env.PORTALDOT_WS || deployment.substrateWs, seed: process.env.RELAYER_SEED, ma: { pool: MA_POOL, assets: MA.assets }, nativeFee: SHIELDED_FEE })
    : null;

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- validation helpers ---
function fieldStr(v, mod, name) {
  let x;
  try {
    x = BigInt(v);
  } catch {
    throw new ClientError(400, `invalid ${name}`);
  }
  if (x < 0n || x >= mod) throw new ClientError(400, `${name} out of field range`);
  return x.toString();
}
function point(arr, n, name) {
  if (!Array.isArray(arr) || arr.length !== n) throw new ClientError(400, `invalid ${name}`);
  return arr;
}

// --- tiny per-IP token bucket ---
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: RATE_PER_MIN, at: now };
  b.tokens = Math.min(RATE_PER_MIN, b.tokens + ((now - b.at) / 60000) * RATE_PER_MIN);
  b.at = now;
  if (b.tokens < 1) return res.status(429).json({ error: "rate limited" });
  b.tokens -= 1;
  buckets.set(ip, b);
  next();
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: CORS_ORIGIN }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Durable checkout is opt-in: CHECKOUT_DATA_DIR must point to a persistent volume.
if (process.env.CHECKOUT_DATA_DIR && native && MA_POOL) {
  const { checkoutRouter } = await import("./checkout.ts");
  const { ReviveProvider } = await import("../sdk/src/reviveProvider.ts");
  const checkoutProvider = new ReviveProvider(async () => native.api, CHAIN_ID);
  const checkoutAsset = MA.assets.find(a => a.symbol === "pUSD");
  if (!checkoutAsset) throw new Error("Checkout requires pUSD in the multi-asset pool");
  app.use("/checkout", checkoutRouter({
    directory: process.env.CHECKOUT_DATA_DIR, chainId: CHAIN_ID, pool: MA_POOL, asset: checkoutAsset,
    finalized: async () => (await native.api.rpc.chain.getHeader(await native.api.rpc.chain.getFinalizedHead())).number.toNumber(),
    logs: (fromBlock, toBlock) => checkoutProvider.getLogs({ address: MA_POOL, fromBlock, toBlock }),
  }));
} else {
  app.use("/checkout", (_req, res) => res.status(503).json({ error: "Checkout is not enabled on this server yet." }));
}

app.use(express.json({ limit: "16kb" }));

app.get("/status", async (_req, res) => {
  res.json({
    relayer: wallet?.address ?? null,
    chainId: CHAIN_ID,
    network: deployment.network,
    feeBps: Number(FEE_BPS),
    crossVm: crossVmEnabled(),
    pools: deployment.contracts.pools,
    tokens: deployment.contracts.tokens || {},
    fees: wallet ? await quotes() : {}, // pool -> exact fee (pool units) to bind into the proof
    // private balance: bind `relayer` and at least `fee` (18-decimal wei) into the proof
    shielded: SHIELDED_POOL && wallet ? { pool: SHIELDED_POOL, fee: SHIELDED_FEE.toString() } : null,
    // multi-asset private balance and private swaps: bind `relayer` (also the swap
    // counterparty) and at least the fee for the transaction's asset
    multiAsset: native
      ? { pool: MA_POOL, relayer: native.evm, fees: Object.fromEntries(Object.entries(await native.fees()).map(([k, v]) => [k, v.toString()])), assets: MA.assets }
      : null,
  });
});

/**
 * Validate a join-split proof request (single- or multi-asset) exactly as the contract will,
 * plus a local Groth16 check, so a bad request never costs gas. Returns the call arguments.
 */
function parseJoinSplit(body, { multi, relayer, minFee, vk }) {
  const { args, extData } = body || {};
  if (!args || !extData) throw new ClientError(400, "missing args or extData");
  const a = point(args.a, 2, "a").map((x) => fieldStr(x, BASE, "a"));
  const b = point(args.b, 2, "b").map((row) => point(row, 2, "b").map((x) => fieldStr(x, BASE, "b")));
  const c = point(args.c, 2, "c").map((x) => fieldStr(x, BASE, "c"));
  const root = fieldStr(args.root, FIELD, "root");
  const publicAmount = fieldStr(args.publicAmount, FIELD, "publicAmount");
  const extDataHash = fieldStr(args.extDataHash, FIELD, "extDataHash");
  const nullifiers = point(args.inputNullifiers, 2, "inputNullifiers").map((x) => fieldStr(x, FIELD, "inputNullifier"));
  const commitments = point(args.outputCommitments, 2, "outputCommitments").map((x) => fieldStr(x, FIELD, "outputCommitment"));
  if (nullifiers[0] === nullifiers[1]) throw new ClientError(400, "duplicate nullifiers");
  let publicAsset = "0", swapAsset = "0", swapAmount = "0";
  if (multi) {
    publicAsset = fieldStr(args.publicAsset, FIELD, "publicAsset");
    swapAsset = fieldStr(args.swapAsset, FIELD, "swapAsset");
    swapAmount = fieldStr(args.swapAmount, MAX_EXT_AMOUNT, "swapAmount");
    if (!MA_ASSET_IDS.has(publicAsset) || !MA_ASSET_IDS.has(swapAsset)) throw new ClientError(400, "unknown asset");
  }

  if (!ethers.isAddress(extData.recipient)) throw new ClientError(400, "invalid recipient");
  if (!ethers.isAddress(extData.relayer) || ethers.getAddress(extData.relayer) !== relayer) {
    throw new ClientError(400, "proof is not bound to this relayer (fetch /status first)");
  }
  let extAmount, fee;
  try {
    extAmount = BigInt(extData.extAmount);
    fee = BigInt(extData.fee);
  } catch {
    throw new ClientError(400, "invalid extAmount or fee");
  }
  // the relayer never funds deposits: it only spends notes the user already holds
  if (extAmount > 0n || extAmount <= -MAX_EXT_AMOUNT) throw new ClientError(400, "the relayer only submits payments, withdrawals and swaps");
  if (fee < minFee(publicAsset) || fee >= MAX_EXT_AMOUNT) throw new ClientError(400, "fee below the relayer's quote (fetch /status)");
  if (extAmount < 0n && ethers.getAddress(extData.recipient) === ethers.ZeroAddress) throw new ClientError(400, "withdrawal needs a recipient");
  for (const k of ["encryptedOutput1", "encryptedOutput2"]) {
    if (!ethers.isHexString(extData[k]) || ethers.dataLength(extData[k]) > MAX_ENCRYPTED_OUTPUT_BYTES) throw new ClientError(400, `invalid ${k}`);
  }
  const ext = {
    recipient: ethers.getAddress(extData.recipient),
    extAmount,
    relayer,
    fee,
    encryptedOutput1: extData.encryptedOutput1,
    encryptedOutput2: extData.encryptedOutput2,
  };

  // the same binding checks the contract makes, before spending any gas
  const hash = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([EXT_DATA_TYPE], [ext]))) % FIELD;
  if (hash.toString() !== extDataHash) throw new ClientError(400, "extDataHash does not match extData");
  const signed = extAmount - fee;
  const expected = signed >= 0n ? signed : FIELD + signed;
  if (expected.toString() !== publicAmount) throw new ClientError(400, "publicAmount does not match extAmount and fee");

  const signals = multi
    ? [root, publicAmount, extDataHash, publicAsset, swapAsset, swapAmount, ...nullifiers, ...commitments]
    : [root, publicAmount, extDataHash, ...nullifiers, ...commitments];
  const callArgs = multi
    ? { a, b, c, root, publicAmount, extDataHash, publicAsset, swapAsset, swapAmount, inputNullifiers: nullifiers, outputCommitments: commitments }
    : { a, b, c, root, publicAmount, extDataHash, inputNullifiers: nullifiers, outputCommitments: commitments };
  return { args: callArgs, ext, nullifiers, root, signals, vk, a, b, c, swap: BigInt(swapAmount) > 0n };
}

/** Nullifier locks, spent/root checks and the local proof check shared by every route. */
async function preflight(p, poolRead, locks) {
  for (const n of p.nullifiers) if (inFlight.has(n)) throw new ClientError(409, "transaction already in progress");
  for (const n of p.nullifiers) {
    inFlight.add(n);
    locks.push(n);
  }
  for (const n of p.nullifiers) if (await poolRead.isSpent(n)) throw new ClientError(409, "note already spent");
  if (!(await poolRead.isKnownRoot(p.root))) throw new ClientError(409, "unknown or stale root; rebuild the proof");
  const snarkProof = {
    pi_a: [p.a[0], p.a[1], "1"],
    pi_b: [[p.b[0][1], p.b[0][0]], [p.b[1][1], p.b[1][0]], ["1", "0"]],
    pi_c: [p.c[0], p.c[1], "1"],
    protocol: "groth16",
    curve: "bn128",
  };
  if (!(await snarkjs.groth16.verify(p.vk, p.signals, snarkProof))) throw new ClientError(400, "invalid proof");
}

function fail(res, e) {
  if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
  if (e?.status === 409) return res.status(409).json({ error: e.message });
  console.error("[relay] internal error:", e);
  res.status(500).json({ error: "relay failed" });
}

/** Relay a join-split `transact` (private payment or withdrawal) for the private balance. */
app.post("/transact", rateLimit, async (req, res) => {
  const locks = [];
  try {
    if (!SHIELDED_POOL || !wallet) throw new ClientError(404, "no private pool relaying on this relayer");
    const p = parseJoinSplit(req.body, { multi: false, relayer: wallet.address, minFee: () => SHIELDED_FEE, vk: txVkey });
    const pool = new ethers.Contract(SHIELDED_POOL, SHIELDED_ABI, wallet);
    await preflight(p, pool, locks);
    const gas = await pool.transact.estimateGas(p.args, p.ext);
    const { gasPrice } = await provider.getFeeData();
    const cost = gas * (gasPrice ?? 0n);
    if (ENFORCE_PROFIT && cost > p.ext.fee) throw new ClientError(503, "fee does not cover gas right now; retry later");
    const tx = await pool.transact(p.args, p.ext, { gasLimit: (gas * 12n) / 10n });
    const receipt = await tx.wait();
    console.log(`[relay] transact ${receipt.hash} fee=${p.ext.fee} gasCost=${cost} withdraw=${p.ext.extAmount < 0n}`);
    res.json({ txHash: receipt.hash, blockHash: receipt.blockHash, fee: p.ext.fee.toString() });
  } catch (e) {
    fail(res, e);
  } finally {
    for (const n of locks) inFlight.delete(n);
  }
});

// --- multi-asset private balance (native relayer) ---

/** Quote a private swap: how much of `buy` the relayer will deliver for `amountIn` of `sell`. */
app.get("/ma/quote", rateLimit, async (req, res) => {
  try {
    if (!native) throw new ClientError(404, "no multi-asset relaying on this relayer");
    const sell = Number(req.query.sell), buy = Number(req.query.buy);
    let amountIn;
    try {
      amountIn = BigInt(String(req.query.amountIn));
    } catch {
      throw new ClientError(400, "invalid amountIn");
    }
    if (amountIn <= 0n || amountIn >= MAX_EXT_AMOUNT || !MA_ASSET_IDS.has(String(sell)) || !MA_ASSET_IDS.has(String(buy)) || sell === buy) {
      throw new ClientError(400, "invalid pair or amount");
    }
    const q = await native.quoteSwap(sell, buy, amountIn);
    res.json({ relayer: native.evm, sell, buy, amountIn: amountIn.toString(), amountOut: q.amountOut.toString(), fee: q.fee.toString(), priceImpactBps: q.priceImpactBps });
  } catch (e) {
    fail(res, e);
  }
});

/** Relay a multi-asset payment/withdrawal (`swapAmount` 0) or execute a private swap. */
app.post("/ma/transact", rateLimit, async (req, res) => {
  const locks = [];
  try {
    if (!native) throw new ClientError(404, "no multi-asset relaying on this relayer");
    const fees = await native.fees();
    const p = parseJoinSplit(req.body, { multi: true, relayer: native.evm, minFee: (asset) => fees[Number(asset)], vk: maVkey });
    if (p.swap) {
      // we are the counterparty: the pool pays us only if we deliver in the same call
      if (p.ext.recipient !== native.evm || p.ext.extAmount >= 0n || p.args.swapAsset === p.args.publicAsset) throw new ClientError(400, "malformed swap");
    } else if (p.args.swapAsset !== "0") {
      throw new ClientError(400, "malformed transaction");
    }
    await preflight(p, maRead, locks);
    const r = p.swap ? await native.swap(p.args, p.ext) : await native.transact(p.args, p.ext);
    console.log(`[relay] ma ${p.swap ? "swap" : "transact"} ${r.blockHash} asset=${p.args.publicAsset} fee=${p.ext.fee}`);
    res.json({ txHash: r.txHash, blockHash: r.blockHash, fee: p.ext.fee.toString() });
  } catch (e) {
    fail(res, e);
  } finally {
    for (const n of locks) inFlight.delete(n);
  }
});

app.post("/withdraw", rateLimit, async (req, res) => {
  let lockKey = null;
  try {
    if (!wallet) throw new ClientError(404, "fixed-pool relaying is not enabled on this relayer");
    const body = req.body || {};
    if (!ethers.isAddress(body.poolAddress)) throw new ClientError(400, "invalid poolAddress");
    const poolAddress = ethers.getAddress(body.poolAddress);
    if (!ALLOWED_POOLS.has(poolAddress)) throw new ClientError(400, "unknown pool");
    if (!ethers.isAddress(body.recipient)) throw new ClientError(400, "invalid recipient");
    const recipient = ethers.getAddress(body.recipient);

    const a = point(body.a, 2, "a").map((x) => fieldStr(x, BASE, "a"));
    const bRows = point(body.b, 2, "b");
    const b = bRows.map((row) => point(row, 2, "b").map((x) => fieldStr(x, BASE, "b")));
    const c = point(body.c, 2, "c").map((x) => fieldStr(x, BASE, "c"));
    const root = fieldStr(body.root, FIELD, "root");
    const nullifierHash = fieldStr(body.nullifierHash, FIELD, "nullifierHash");

    if (inFlight.has(nullifierHash)) throw new ClientError(409, "withdrawal already in progress");
    inFlight.add(nullifierHash);
    lockKey = nullifierHash;

    const pool = new ethers.Contract(poolAddress, POOL_ABI, wallet);
    const denom = await pool.denomination();
    const fee = feeFor(poolAddress, denom);

    if (await pool.isSpent(nullifierHash)) throw new ClientError(409, "note already spent");
    if (!(await pool.isKnownRoot(root))) throw new ClientError(409, "unknown or stale root");

    const publicSignals = [root, nullifierHash, BigInt(recipient).toString(), BigInt(wallet.address).toString(), fee.toString(), "0"];

    // cheap local pre-check before spending any gas
    const snarkProof = {
      pi_a: [a[0], a[1], "1"],
      pi_b: [[b[0][1], b[0][0]], [b[1][1], b[1][0]], ["1", "0"]],
      pi_c: [c[0], c[1], "1"],
      protocol: "groth16",
      curve: "bn128",
    };
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, snarkProof))) {
      throw new ClientError(400, "invalid proof (wrong relayer/fee? fetch /status first)");
    }

    // fail-closed WASM verification when the pool is wired to the coprocessor bridge
    if (deployment.verifierMode === "coprocessor") {
      if (!crossVmEnabled()) throw new Error("coprocessor deployment requires CROSS_VM=1 on the relayer");
      await crossVmAttest({ a, b, c, publicSignals, bridgeAddress: deployment.contracts.withdrawVerifier, evmWallet: wallet });
    }

    const args = [a, b, c, root, nullifierHash, recipient, wallet.address, fee, 0];
    const gas = await pool.withdraw.estimateGas(...args);
    const { gasPrice } = await provider.getFeeData();
    const cost = gas * (gasPrice ?? 0n);
    if (ENFORCE_PROFIT && cost > fee) throw new ClientError(503, "fee does not cover gas right now; retry later");

    const tx = await pool.withdraw(...args, { gasLimit: (gas * 12n) / 10n });
    const receipt = await tx.wait();
    console.log(`[relay] ${receipt.hash} pool=${poolAddress} fee=${fee} gasCost=${cost}`);
    res.json({ txHash: receipt.hash, fee: fee.toString(), recipient });
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
    console.error("[relay] internal error:", e);
    res.status(500).json({ error: "relay failed" });
  } finally {
    if (lockKey) inFlight.delete(lockKey);
  }
});

app.listen(PORT, () => console.log(`Umbra relayer on :${PORT} (${deployment.network}) evm=${wallet?.address ?? "-"} native=${native ? `${native.account} (${native.evm})` : "-"}`));
