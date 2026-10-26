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

if (!process.env.PRIVATE_KEY) throw new Error("set PRIVATE_KEY");
const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

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
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/status", async (_req, res) => {
  res.json({
    relayer: wallet.address,
    chainId: CHAIN_ID,
    network: deployment.network,
    feeBps: Number(FEE_BPS),
    crossVm: crossVmEnabled(),
    pools: deployment.contracts.pools,
    tokens: deployment.contracts.tokens || {},
    fees: await quotes(), // pool -> exact fee (pool units) to bind into the proof
    // private balance: bind `relayer` and at least `fee` (18-decimal wei) into the proof
    shielded: SHIELDED_POOL ? { pool: SHIELDED_POOL, fee: SHIELDED_FEE.toString() } : null,
  });
});

/** Relay a join-split `transact` (private payment or withdrawal) for the private balance. */
app.post("/transact", rateLimit, async (req, res) => {
  const locks = [];
  try {
    if (!SHIELDED_POOL) throw new ClientError(404, "no private pool on this network");
    const { args, extData } = req.body || {};
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

    if (!ethers.isAddress(extData.recipient)) throw new ClientError(400, "invalid recipient");
    if (!ethers.isAddress(extData.relayer) || ethers.getAddress(extData.relayer) !== wallet.address) {
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
    if (extAmount > 0n || extAmount <= -MAX_EXT_AMOUNT) throw new ClientError(400, "the relayer only submits payments and withdrawals");
    if (fee < SHIELDED_FEE || fee >= MAX_EXT_AMOUNT) throw new ClientError(400, "fee below the relayer's quote (fetch /status)");
    if (extAmount < 0n && ethers.getAddress(extData.recipient) === ethers.ZeroAddress) throw new ClientError(400, "withdrawal needs a recipient");
    for (const k of ["encryptedOutput1", "encryptedOutput2"]) {
      if (!ethers.isHexString(extData[k]) || ethers.dataLength(extData[k]) > MAX_ENCRYPTED_OUTPUT_BYTES) throw new ClientError(400, `invalid ${k}`);
    }
    const ext = {
      recipient: ethers.getAddress(extData.recipient),
      extAmount,
      relayer: wallet.address,
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

    for (const n of nullifiers) {
      if (inFlight.has(n)) throw new ClientError(409, "transaction already in progress");
    }
    for (const n of nullifiers) {
      inFlight.add(n);
      locks.push(n);
    }

    const pool = new ethers.Contract(SHIELDED_POOL, SHIELDED_ABI, wallet);
    for (const n of nullifiers) if (await pool.isSpent(n)) throw new ClientError(409, "note already spent");
    if (!(await pool.isKnownRoot(root))) throw new ClientError(409, "unknown or stale root; rebuild the proof");

    const snarkProof = {
      pi_a: [a[0], a[1], "1"],
      pi_b: [[b[0][1], b[0][0]], [b[1][1], b[1][0]], ["1", "0"]],
      pi_c: [c[0], c[1], "1"],
      protocol: "groth16",
      curve: "bn128",
    };
    if (!(await snarkjs.groth16.verify(txVkey, [root, publicAmount, extDataHash, ...nullifiers, ...commitments], snarkProof))) {
      throw new ClientError(400, "invalid proof");
    }

    const callArgs = [{ a, b, c, root, publicAmount, extDataHash, inputNullifiers: nullifiers, outputCommitments: commitments }, ext];
    const gas = await pool.transact.estimateGas(...callArgs);
    const { gasPrice } = await provider.getFeeData();
    const cost = gas * (gasPrice ?? 0n);
    if (ENFORCE_PROFIT && cost > fee) throw new ClientError(503, "fee does not cover gas right now; retry later");

    const tx = await pool.transact(...callArgs, { gasLimit: (gas * 12n) / 10n });
    const receipt = await tx.wait();
    console.log(`[relay] transact ${receipt.hash} fee=${fee} gasCost=${cost} withdraw=${extAmount < 0n}`);
    res.json({ txHash: receipt.hash, blockHash: receipt.blockHash, fee: fee.toString() });
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
    console.error("[relay] internal error:", e);
    res.status(500).json({ error: "relay failed" });
  } finally {
    for (const n of locks) inFlight.delete(n);
  }
});

app.post("/withdraw", rateLimit, async (req, res) => {
  let lockKey = null;
  try {
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

app.listen(PORT, () => console.log(`Umbra relayer on :${PORT} as ${wallet.address} (${deployment.network})`));
