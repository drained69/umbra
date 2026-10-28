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
type Options = { directory: string; chainId: number; pool: string; asset: { id: number; decimals: number; symbol: string }; finalized: () => Promise<number>; logs: (from: number, to: number) => Promise<any[]>; readTimeoutMs?: number; cooldownMs?: number };

/** Single-process store. Deploy with one replica and a persistent volume. Never stores spending keys. */
export function checkoutRouter(opts: Options) {
  mkdirSync(opts.directory, { recursive: true, mode: 0o700 });
  const file = join(opts.directory, "checkout.json");
  let db: State;
  try { db = JSON.parse(readFileSync(file, "utf8")); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; db = { products: [], orders: [] }; }
  const save = (next: State) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    db = next; // Publish only after persistence succeeds.
  };
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); res.set("Referrer-Policy", "no-referrer"); next(); });
  const buckets = new Map<string, { at: number; requests: number; creates: number }>();
  router.use((req, res, next) => {
    const now = Date.now(), ip = req.ip ?? "unknown";
    if (!buckets.has(ip) && buckets.size >= 10000) {
      for (const [key, value] of buckets) if (now - value.at > 60000) buckets.delete(key);
      if (buckets.size >= 10000) return res.status(429).set("Retry-After", "60").json({ error: "Checkout is busy. Please retry in one minute." });
    }
    const b = buckets.get(ip) ?? { at: now, requests: 60, creates: 10 };
    b.requests = Math.min(60, b.requests + (now - b.at) / 1000);
    b.creates = Math.min(10, b.creates + (now - b.at) / 6000);
    b.at = now; buckets.set(ip, b);
    const creates = req.method === "POST" && !req.path.endsWith("/verify");
    if (b.requests < 1 || (creates && b.creates < 1)) return res.status(429).set("Retry-After", "60").json({ error: "Too many checkout requests. Please retry in one minute." });
    b.requests--; if (creates) b.creates--;
    next();
  });
  router.use(express.json({ limit: "64kb" }));
  router.use((err: any, _req: any, res: any, next: any) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Checkout request is too large." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid checkout request." });
    next(err);
  });
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
    save({ ...db, products: [...db.products, p] }); res.status(201).json({ product: publicProduct(p), token });
  }));
  router.get("/products/:id", (req, res) => {
    const p = db.products.find(p => p.id === req.params.id);
    return p ? res.json(publicProduct(p)) : res.status(404).json({ error: "Product not found." });
  });
  router.get("/products/:id/orders", wrap(async (req: any, res: any) => {
    const p = db.products.find(p => p.id === req.params.id);
    if (!p || !admin(req, p)) return res.status(401).json({ error: "Merchant access key required." });
    await check(db.orders.filter(o => o.productId === p.id).map(o => o.id));
    return res.json(db.orders.filter(o => o.productId === p.id).map(o => ({ id: o.id, created: o.created, status: o.status, block: o.block })));
  }));
  router.post("/products/:id/orders", wrap(async (req: any, res: any) => {
    const p = db.products.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Product not found." });
    if (db.orders.length >= 10000) return res.status(409).json({ error: "Checkout order capacity reached." });
    const fromBlock = await readChain(opts.finalized());
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("Invalid finalized height");
    // Recheck after the asynchronous read: concurrent requests may have filled capacity.
    if (db.orders.length >= 10000) return res.status(409).json({ error: "Checkout order capacity reached." });
    const orderId = id();
    const u = new Utxo({ keypair: Keypair.fromAddress(p.to), asset: BigInt(opts.asset.id), amount: ethers.parseUnits(p.amount, opts.asset.decimals), memo: `checkout:${orderId}` });
    // Precommit to a unique note AND its valid merchant-encrypted ciphertext. A matching
    // finalized event proves the merchant can discover and spend the exact payment.
    const o: Order = { id: orderId, productId: p.id, created: Date.now(), fromBlock, cursor: fromBlock, blinding: u.blinding.toString(), commitment: u.commitment().toString(), encryptedOutput: ethers.hexlify(u.encryptTo(u.keypair.encPublic)), status: "awaiting" };
    save({ ...db, orders: [...db.orders, o] }); res.status(201).json(o);
  }));
  router.get("/orders/:id", (req, res) => {
    const o = db.orders.find(o => o.id === req.params.id);
    return o ? res.json(o) : res.status(404).json({ error: "Order not found." });
  });
  let checking: Promise<void> | null = null;
  const checkedAt = new Map<string, number>();
  async function readChain<T>(request: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([request, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Checkout chain read timed out")), opts.readTimeoutMs ?? 20000);
      })]);
    } finally { clearTimeout(timer!); }
  }
  // Serialize scans, but scope their cursors to the requested order or merchant.
  // An abandoned order belonging to another buyer cannot hold a new payment behind it.
  async function check(ids: string[]) {
    while (checking) await checking.catch(() => {});
    const selected = new Set(ids);
    const pending = db.orders.filter(o => selected.has(o.id) && o.status === "awaiting" && Date.now() - (checkedAt.get(o.id) ?? 0) >= (opts.cooldownMs ?? 10000));
    if (!pending.length) return;
    checking = (async () => {
      const from = Math.min(...pending.map(o => o.cursor));
      const end = Math.min(await readChain(opts.finalized()), from + 1999);
      if (!Number.isSafeInteger(end) || end < 0) throw new Error("Invalid finalized height");
      if (end < from) return;
      const logs = await readChain(opts.logs(from, end));
      const updated = new Map(pending.map(o => [o.id, { ...o }]));
      const commitments = new Map([...updated.values()].map(o => [o.commitment, o]));
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== opts.pool.toLowerCase() || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < from || log.blockNumber > end) continue;
        let parsed; try { parsed = event.parseLog(log); } catch { continue; }
        if (!parsed) continue;
        const o = commitments.get(parsed.args.commitment.toString());
        if (o && o.encryptedOutput.toLowerCase() === parsed.args.encryptedOutput.toLowerCase() && log.blockNumber >= o.fromBlock) {
          o.status = "paid"; o.block = log.blockNumber;
        }
      }
      for (const o of updated.values()) o.cursor = Math.max(o.cursor, end + 1);
      // Use the current db so orders created while RPC was pending are retained.
      save({ ...db, orders: db.orders.map(o => updated.get(o.id) ?? o) });
      for (const o of pending) if (o.cursor <= end) checkedAt.set(o.id, Date.now());
    })().finally(() => { checking = null; });
    await checking;
  }
  router.post("/orders/:id/verify", wrap(async (req: any, res: any) => {
    const o = db.orders.find(o => o.id === req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found." });
    if (o.status !== "paid") await check([o.id]);
    res.json(db.orders.find(current => current.id === o.id));
  }));
  router.get("/orders/:id/download", (req, res) => {
    const o = db.orders.find(o => o.id === req.params.id);
    if (!o || o.status !== "paid") return res.status(403).json({ error: "A finalized payment is required before downloading." });
    const p = db.products.find(p => p.id === o.productId)!;
    res.set("Content-Disposition", 'attachment; filename="umbra-purchase.txt"').type("text/plain").send(p.delivery);
  });
  return router;
}
