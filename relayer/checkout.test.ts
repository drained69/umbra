import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { ethers } from "ethers";
import { checkoutRouter } from "./checkout";
import { Keypair } from "../sdk/src/keypair";
import { Utxo } from "../sdk/src/utxo";

const pool = "0x1111111111111111111111111111111111111111";
const iface = new ethers.Interface(["event NewCommitment(uint256 indexed commitment, uint256 index, bytes encryptedOutput)"]);
async function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), "umbra-checkout-test-"));
  const owner = new Keypair(); let finalized = 10; let logs: any[] = [];
  const options = { directory, chainId: 31337, pool, asset: { id: 1, decimals: 6, symbol: "pUSD" }, finalized: async () => finalized, logs: async () => logs };
  const app = express(); app.use(express.json()); app.use(checkoutRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string, body?: any, token?: string) => fetch(url + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const input = { name: "Guide", description: "Digital product", amount: "2.5", to: owner.address(), delivery: "PAID CONTENT" };
  const created = await request("/products", input); assert.equal(created.status, 201);
  const merchant = await created.json();
  const order = await (await request(`/products/${merchant.product.id}/orders`, {})).json();
  const log = (commitment = order.commitment, ciphertext = order.encryptedOutput, blockNumber = 11, address = pool) => ({ ...iface.encodeEventLog(iface.getEvent("NewCommitment")!, [commitment, 0, ciphertext]), blockNumber, address, removed: false });
  return { request, owner, order, merchant, options, input, log, setChain: (rows: any[], block = 12) => { logs = rows; finalized = block; } };
}

test("server creates a note merchant can decrypt with the exact product amount and asset", async t => {
  const f = await fixture(t);
  const note = Utxo.decrypt(ethers.getBytes(f.order.encryptedOutput), f.owner, 0)!;
  assert.ok(note); assert.equal(note.amount, 2500000n); assert.equal(note.asset, 1n);
  assert.equal(note.commitment().toString(), f.order.commitment);
  assert.equal(note.memo, `checkout:${f.order.id}`);
  const p = await (await f.request(`/products/${f.merchant.product.id}`)).json();
  assert.equal(p.delivery, undefined); assert.equal(p.adminHash, undefined); assert.equal(p.token, undefined);
});
test("unpaid downloads and unauthenticated merchant dashboards are denied", async t => {
  const f = await fixture(t);
  assert.equal((await f.request(`/orders/${f.order.id}/download`)).status, 403);
  assert.equal((await f.request(`/products/${f.merchant.product.id}/orders`)).status, 401);
  assert.equal((await f.request(`/products/${f.merchant.product.id}/orders`, undefined, "wrong-key")).status, 401);
});
test("buyer-controlled paid flags cannot settle an order", async t => {
  const f = await fixture(t); f.setChain([]);
  const result = await (await f.request(`/orders/${f.order.id}/verify`, { status: "paid", amount: "2.5", txHash: "fake" })).json();
  assert.equal(result.status, "awaiting");
  assert.equal((await f.request(`/orders/${f.order.id}/download`)).status, 403);
});
test("wrong recipient, amount, asset, ciphertext and contract never unlock content", async t => {
  const f = await fixture(t);
  const note = Utxo.decrypt(ethers.getBytes(f.order.encryptedOutput), f.owner, 0)!;
  const wrongAmount = new Utxo({ ...note, amount: note.amount - 1n });
  const wrongAsset = new Utxo({ ...note, asset: 0n });
  const wrongOwner = new Utxo({ ...note, keypair: new Keypair() });
  f.setChain([f.log(wrongAmount.commitment()), f.log(wrongAsset.commitment()), f.log(wrongOwner.commitment()), f.log(undefined, "0xabcd"), f.log(undefined, undefined, 11, "0x2222222222222222222222222222222222222222")]);
  const result = await (await f.request(`/orders/${f.order.id}/verify`, {})).json();
  assert.equal(result.status, "awaiting");
});
test("unfinalized, removed and pre-order events cannot settle", async t => {
  const f = await fixture(t);
  f.setChain([f.log(undefined, undefined, 13), { ...f.log(), removed: true }, f.log(undefined, undefined, 9)], 12);
  assert.equal((await (await f.request(`/orders/${f.order.id}/verify`, {})).json()).status, "awaiting");
});
test("finalized receipt unlocks content, persists, and cannot pay a second order", async t => {
  const f = await fixture(t);
  const second = await (await f.request(`/products/${f.merchant.product.id}/orders`, {})).json();
  assert.notEqual(second.commitment, f.order.commitment);
  f.setChain([f.log()]);
  const result = await (await f.request(`/orders/${f.order.id}/verify`, {})).json();
  assert.equal(result.status, "paid"); assert.equal(result.block, 11);
  const content = await f.request(`/orders/${f.order.id}/download`);
  assert.equal(content.status, 200); assert.equal(await content.text(), "PAID CONTENT");
  assert.equal((await (await f.request(`/orders/${second.id}`)).json()).status, "awaiting");
  const app = express(); app.use(checkoutRouter(f.options));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); t.after(() => server.close());
  const restored = await fetch(`http://127.0.0.1:${(server.address() as any).port}/orders/${f.order.id}/download`);
  assert.equal(await restored.text(), "PAID CONTENT");
});
test("merchant refresh independently verifies payments", async t => {
  const f = await fixture(t); f.setChain([f.log()]);
  const rows = await (await f.request(`/products/${f.merchant.product.id}/orders`, undefined, f.merchant.token)).json();
  assert.equal(rows[0].status, "paid"); assert.equal(rows[0].blinding, undefined);
});
test("invalid addresses, prices and oversized delivery are rejected", async t => {
  const f = await fixture(t);
  for (const changes of [{ amount: "0" }, { amount: "-1" }, { amount: "1.0000001" }, { to: "umbra-addr-fake" }, { delivery: "x".repeat(6001) }]) {
    assert.equal((await f.request("/products", { ...f.input, ...changes })).status, 400);
  }
});
