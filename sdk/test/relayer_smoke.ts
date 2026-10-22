/*
 * Relayer integration smoke test (local Anvil + running relayer on :8787).
 * Checks input validation, pool allowlist, a real gasless withdrawal, and replay rejection.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { UmbraPoolClient, createNote } from "../src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "local.json"), "utf8"));
const R = process.env.RELAYER_URL || "http://127.0.0.1:8787";
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ART = { wasm: join(ROOT, "sdk/artifacts/withdraw.wasm"), zkey: join(ROOT, "sdk/artifacts/withdraw_final.zkey") };

let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};
const post = async (body: unknown) => {
  const r = await fetch(`${R}/withdraw`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};

const provider = new ethers.JsonRpcProvider(process.env.E2E_RPC || "http://127.0.0.1:8545");
const alice = new ethers.Wallet(KEY0, provider);
const status = (await (await fetch(`${R}/status`)).json()) as any;
check(ethers.isAddress(status.relayer) && status.feeBps === 50, "/status exposes relayer address + fee");

check((await post({ poolAddress: "nope" })).status === 400, "rejects malformed poolAddress");
check((await post({ poolAddress: ethers.Wallet.createRandom().address, recipient: alice.address })).status === 400, "rejects non-allowlisted pool");
const pool1 = dep.contracts.pools["1"];
check((await post({ poolAddress: pool1, recipient: alice.address, a: ["1"], b: [], c: [], root: "1", nullifierHash: "1" })).status === 400, "rejects malformed proof shape");
check(
  (await post({ poolAddress: pool1, recipient: alice.address, a: ["1", "2"], b: [["1", "2"], ["3", "4"]], c: ["1", "2"], root: (2n ** 256n - 1n).toString(), nullifierHash: "1" })).status === 400,
  "rejects out-of-field root"
);

const pool = new UmbraPoolClient(pool1, alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
const denom = await pool.denomination();
const note = createNote(denom);
await pool.deposit(note);
const fresh = ethers.Wallet.createRandom().address;
const fee = (denom * BigInt(status.feeBps)) / 10_000n;

// proof bound to the WRONG fee must be refused before any gas is spent
const bad = await pool.buildWithdraw(note, fresh, status.relayer, fee + 1n, ART);
const rb = await post({ poolAddress: pool1, recipient: fresh, a: bad.a, b: bad.b, c: bad.c, root: bad.root.toString(), nullifierHash: bad.nullifierHash.toString() });
check(rb.status === 400, "refuses a proof bound to a different fee (no gas spent)");

const p = await pool.buildWithdraw(note, fresh, status.relayer, fee, ART);
const body = { poolAddress: pool1, recipient: fresh, a: p.a, b: p.b, c: p.c, root: p.root.toString(), nullifierHash: p.nullifierHash.toString() };
const ok = await post(body);
check(ok.status === 200 && typeof ok.json.txHash === "string", "relays a valid withdrawal");
check((await provider.getBalance(fresh)) === denom - fee, "fresh recipient (no gas ever) received denom - fee");
const replay = await post(body);
check(replay.status === 409, "replay rejected as already spent (no gas burned)");

console.log(`\nRELAYER SMOKE PASSED: ${n} checks`);
process.exit(0);
