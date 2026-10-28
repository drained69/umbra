// Real Groth16 payment -> finalized contract event -> gated download on local Anvil.
import express from "express";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ethers } from "ethers";
import { Keypair, Utxo, UmbraMultiAssetClient } from "../sdk/src/index";
import { checkoutRouter } from "./checkout";

const root = join(import.meta.dirname, "..");
const dep = JSON.parse(readFileSync(join(root, "deployments/local.json"), "utf8"));
const provider = new ethers.JsonRpcProvider(process.env.E2E_RPC || "http://127.0.0.1:8545");
assert.equal(Number((await provider.getNetwork()).chainId), 31337, "Local chain only");
// Public Anvil development key; never use this account outside a local test chain.
const payer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);
const pool = dep.contracts.multiAssetPool.address;
const directory = mkdtempSync(join(tmpdir(), "umbra-checkout-e2e-"));
const owner = new Keypair();
const app = express(); app.use(express.json());
app.use(checkoutRouter({ directory, pool, chainId: 31337, asset: { id: 1, decimals: 6, symbol: "pUSD" }, finalized: async () => Number(await provider.send("eth_blockNumber", [])), logs: (fromBlock, toBlock) => provider.getLogs({ address: pool, fromBlock, toBlock }) }));
const server = app.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const post = async (path: string, body: any) => { const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); assert.ok(r.ok, await r.clone().text()); return r.json(); };
try {
  const m = await post("/products", { name: "Proof-tested guide", description: "", amount: "1", to: owner.address(), delivery: "Verified digital delivery" });
  const order = await post(`/products/${m.product.id}/orders`, {});
  assert.equal((await fetch(`${base}/orders/${order.id}/download`)).status, 403);
  const note = new Utxo({ keypair: Keypair.fromAddress(owner.address()), asset: 1n, amount: 1000000n, blinding: BigInt(order.blinding), memo: `checkout:${order.id}` });
  note.encryptTo = () => ethers.getBytes(order.encryptedOutput);
  assert.equal(note.commitment().toString(), order.commitment);
  const client = new UmbraMultiAssetClient(pool, payer, { deployBlock: dep.deployBlock, chunkSize: 50 });
  const plan = client.planDeposit(new Keypair(), 1n, 1000000n, owner.address()); plan.outputs[0] = note;
  await client.transact(plan, { wasm: join(root, "sdk/artifacts/multiasset.wasm"), zkey: join(root, "sdk/artifacts/multiasset_final.zkey") }, payer);
  const settled = await post(`/orders/${order.id}/verify`, {});
  assert.equal(settled.status, "paid");
  assert.equal(await (await fetch(`${base}/orders/${order.id}/download`)).text(), "Verified digital delivery");
  const received = await client.myNotes(owner);
  assert.equal(received[0].utxo.amount, 1000000n);
  assert.equal(received[0].utxo.memo, `checkout:${order.id}`);
  // Prove the merchant can spend the received note, not merely decrypt it.
  await client.transact(await client.planPayment({ owner, to: new Keypair().address(), asset: 1n, amount: 1000000n }), { wasm: join(root, "sdk/artifacts/multiasset.wasm"), zkey: join(root, "sdk/artifacts/multiasset_final.zkey") }, payer);
  assert.equal(UmbraMultiAssetClient.balances(await client.myNotes(owner)).get(1n) ?? 0n, 0n);
  console.log("Checkout E2E passed: real proof, exact receipt, gated delivery, merchant discovery and spend.");
} finally { server.close(); rmSync(directory, { recursive: true, force: true }); }
process.exit(0);
