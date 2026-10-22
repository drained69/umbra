#!/usr/bin/env node
/*
 * Umbra withdrawal relayer.
 *
 * Why it matters for privacy: a user who just received shielded funds should be able to
 * withdraw to a fresh address that has never held gas. The relayer pays gas and takes a
 * small fee out of the denomination, so the recipient address stays pristine and
 * unlinkable. The proof binds recipient/relayer/fee, so the relayer cannot cheat.
 *
 * Optional cross-VM mode (CROSS_VM=1): before submitting, the relayer asks the ink!/WASM
 * coprocessor to verify the proof and mirrors the result on-chain via the bridge, so the
 * EVM withdrawal is gated by a WASM-VM verification. See crossvm.js.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as snarkjs from "snarkjs";
import { maybeCrossVmAttest } from "./crossvm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const RPC = process.env.PORTALDOT_RPC || "https://test-evm-rpc-v3.portaldot.dev";
const CHAIN_ID = Number(process.env.PORTALDOT_CHAIN_ID || 420420777);
const FEE_BPS = BigInt(process.env.RELAYER_FEE_BPS || 50);
const PORT = Number(process.env.RELAYER_PORT || 8787);

const deployment = JSON.parse(readFileSync(join(ROOT, "deployments", "portaldot-v3.json"), "utf8"));
const vkey = JSON.parse(readFileSync(join(ROOT, "circuits", "build", "withdraw_verification_key.json"), "utf8"));

const POOL_ABI = [
  "function denomination() view returns (uint256)",
  "function isSpent(uint256) view returns (bool)",
  "function isKnownRoot(uint256) view returns (bool)",
  "function withdraw(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund) payable",
];

const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/status", async (_req, res) => {
  res.json({
    relayer: wallet.address,
    chainId: CHAIN_ID,
    feeBps: Number(FEE_BPS),
    crossVm: process.env.CROSS_VM === "1",
    pools: deployment.contracts.pools,
  });
});

app.post("/withdraw", async (req, res) => {
  try {
    const { poolAddress, a, b, c, root, nullifierHash, recipient } = req.body;
    if (!poolAddress || !a || !b || !c || root == null || nullifierHash == null || !recipient) {
      return res.status(400).json({ error: "missing fields" });
    }
    const pool = new ethers.Contract(poolAddress, POOL_ABI, wallet);
    const denom = await pool.denomination();
    const fee = (denom * FEE_BPS) / 10000n;

    // Guard 1: note not already spent; root is fresh.
    if (await pool.isSpent(nullifierHash)) return res.status(409).json({ error: "note already spent" });
    if (!(await pool.isKnownRoot(root))) return res.status(409).json({ error: "unknown/stale root" });

    const publicSignals = [
      BigInt(root).toString(),
      BigInt(nullifierHash).toString(),
      BigInt(recipient).toString(),
      BigInt(wallet.address).toString(), // relayer == us; proof is bound to this
      fee.toString(),
      "0",
    ];

    // Guard 2: cheap local proof check before spending gas.
    const snarkProof = {
      pi_a: [a[0], a[1], "1"],
      pi_b: [[b[0][1], b[0][0]], [b[1][1], b[1][0]], ["1", "0"]],
      pi_c: [c[0], c[1], "1"],
      protocol: "groth16",
      curve: "bn128",
    };
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, snarkProof);
    if (!ok) return res.status(400).json({ error: "invalid proof" });

    // Optional: gate on a WASM-VM verification (cross-VM demo).
    await maybeCrossVmAttest({ a, b, c, publicSignals, deployment, evmWallet: wallet });

    // Submit the withdrawal; relayer pays gas, recipient gets denom - fee.
    const tx = await pool.withdraw(a, b, c, root, nullifierHash, recipient, wallet.address, fee, 0);
    const receipt = await tx.wait();
    res.json({ txHash: receipt.hash, fee: fee.toString(), recipient });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log(`Umbra relayer on :${PORT} as ${wallet.address}`));
