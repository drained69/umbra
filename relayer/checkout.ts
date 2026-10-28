import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import { Keypair } from "../sdk/src/keypair";
import { Utxo } from "../sdk/src/utxo";
import { FIELD_SIZE } from "../sdk/src/field";

const id = () => randomBytes(32).toString("hex");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const event = new ethers.Interface(["event NewCommitment(uint256 indexed commitment, uint256 index, bytes encryptedOutput)"]);
type Product = { id: string; name: string; description: string; amount: string; to: string; adminHash: string; delivery: string };
type Order = { id: string; productId: string; created: number; fromBlock: number; cursor: number; blinding: string; commitment: string; encryptedOutput: string; status: "awaiting" | "paid"; block?: number };
type State = { products: Product[]; orders: Order[] };
type Options = { directory: string; chainId: number; pool: string; asset: { id: number; decimals: number; symbol: string }; finalized: () => Promise<number>; logs: (from: number, to: number) => Promise<any[]> };

/** Single-process store. Deploy with one replica and a persistent volume. Never stores spending keys. */
export function checkoutRouter(opts: Options) {
  mkdirSync(opts.directory, { recursive: true, mode: 0o700 });
  const file = join(opts.directory, "checkout.json");
  let db: State;
  try { db = JSON.parse(readFileSync(file, "utf8")); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; db = { products: [], orders: [] }; }
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(db), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer"); next(); });
  const wrap = (fn: any) => async (req: any, res: any) => {
    try { await fn(req, res); } catch (e: any) { console.error("checkout:", e.message); res.status(503).json({ error: "Checkout could not complete this request. Please retry." }); }
  };
  const publicProduct = (p: Product) => ({ id: p.id, name: p.name, description: p.description, amount: p.amount, to: p.to, asset: opts.asset, chainId: opts.chainId, pool: opts.pool });
  const admin = (req: any, p: Product) => hash(req.get("authorization")?.replace(/^Bearer /, "") ?? "") === p.adminHash;
  const text = (x: unknown, max: number) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
  router.post("/products", wrap(async (req: any, res: any) => {
    const { name, description = "", amount, to, delivery } = req.body ?? {};
    if (!text(name, 80) || typeof description !== "string" || description.length > 280 || !text(delivery, 6000) || !text(to, 150) || !/^\d{1,12}(\.\d{1,6})?$/.test(amount ?? "")) return res.status(400).json({ error: "Enter a product name, valid pUSD price, private address and text download (up to 6,000 characters)." });
    let owner: Keypair;
    try {
      if (!/^umbra-addr-[a-f0-9]{64}-[a-f0-9]{64}$/i.test(to)) throw Error();
      owner = Keypair.fromAddress(to);
      if (owner.publicKey <= 0n || owner.publicKey >= FIELD_SIZE || ethers.parseUnits(amount, opts.asset.decimals) <= 0n) throw Error();
      new Utxo({ keypair: owner }).encryptTo(owner.encPublic);
    } catch { return res.status(400).json({ error: "Invalid private address or price." }); }
    if (db.products.length >= 1000) return res.status(409).json({ error: "Checkout product capacity reached." });
    const token = id();
    const p = { id: id(), name: name.trim(), description: description.trim(), amount, to, delivery, adminHash: hash(token) };
    db.products.push(p); save(); res.status(201).json({ product: publicProduct(p), token });
  }));
  router.get("/products/:id", (req, res) => {
    const p = db.products.find(p => p.id === req.params.id);
    return p ? res.json(publicProduct(p)) : res.status(404).json({ error: "Product not found." });
  });
  router.get("/products/:id/orders", wrap(async (req: any, res: any) => {
    const p = db.products.find(p => p.id === req.params.id);
    if (!p || !admin(req, p)) return res.status(401).json({ error: "Merchant access key required." });
    await check();
    return res.json(db.orders.filter(o => o.productId === p.id).map(o => ({ id: o.id, created: o.created, status: o.status, block: o.block })));
  }));
  router.post("/products/:id/orders", wrap(async (req: any, res: any) => {
    const p = db.products.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Product not found." });
    if (db.orders.length >= 10000) return res.status(409).json({ error: "Checkout order capacity reached." });
    const fromBlock = await opts.finalized();
    const orderId = id();
    const u = new Utxo({ keypair: Keypair.fromAddress(p.to), asset: BigInt(opts.asset.id), amount: ethers.parseUnits(p.amount, opts.asset.decimals), memo: `checkout:${orderId}` });
    // Precommit to a unique note AND its valid merchant-encrypted ciphertext. A matching
    // finalized event proves the merchant can discover and spend the exact payment.
    const o: Order = { id: orderId, productId: p.id, created: Date.now(), fromBlock, cursor: fromBlock, blinding: u.blinding.toString(), commitment: u.commitment().toString(), encryptedOutput: ethers.hexlify(u.encryptTo(u.keypair.encPublic)), status: "awaiting" };
    db.orders.push(o); save(); res.status(201).json(o);
  }));
  router.get("/orders/:id", (req, res) => {
    const o = db.orders.find(o => o.id === req.params.id);
    return o ? res.json(o) : res.status(404).json({ error: "Order not found." });
  });
  let checking: Promise<void> | null = null;
  let lastCheck = 0;
  // One scan for all pending orders, bounded and incremental; buyer-supplied status,
  // amount, transaction hash or redirects are never settlement evidence.
  async function check() {
    if (checking) return checking;
    if (Date.now() - lastCheck < 10000) return;
    checking = (async () => {
      const pending = db.orders.filter(o => o.status === "awaiting");
      if (!pending.length) return;
      const from = Math.min(...pending.map(o => o.cursor));
      const end = Math.min(await opts.finalized(), from + 1999);
      if (end < from) return;
      const logs = await opts.logs(from, end);
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== opts.pool.toLowerCase() || log.blockNumber < from || log.blockNumber > end) continue;
        let parsed; try { parsed = event.parseLog(log); } catch { continue; }
        if (!parsed) continue;
        const o = pending.find(o => o.commitment === parsed!.args.commitment.toString() && o.encryptedOutput.toLowerCase() === parsed!.args.encryptedOutput.toLowerCase() && log.blockNumber >= o.fromBlock);
        if (o) { o.status = "paid"; o.block = log.blockNumber; }
      }
      for (const o of pending) o.cursor = Math.max(o.cursor, end + 1);
      save(); lastCheck = Date.now();
    })().finally(() => { checking = null; });
    return checking;
  }
  router.post("/orders/:id/verify", wrap(async (req: any, res: any) => {
    const o = db.orders.find(o => o.id === req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found." });
    if (o.status !== "paid") await check();
    res.json(o);
  }));
  router.get("/orders/:id/download", (req, res) => {
    const o = db.orders.find(o => o.id === req.params.id);
    if (!o || o.status !== "paid") return res.status(403).json({ error: "A finalized payment is required before downloading." });
    const p = db.products.find(p => p.id === o.productId)!;
    res.set("Content-Disposition", 'attachment; filename="umbra-purchase.txt"').type("text/plain").send(p.delivery);
  });
  return router;
}
