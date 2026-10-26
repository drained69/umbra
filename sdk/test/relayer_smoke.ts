/*
 * Relayer integration smoke test (local Anvil + running relayer on :8787).
 * Checks input validation, pool allowlist, a real gasless withdrawal, and replay rejection.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Keypair, UmbraShieldedClient, Utxo, createNote, getRelayerQuote, relayTransact, UmbraPoolClient } from "../src/index";

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
check(ethers.isAddress(status.relayer) && status.feeBps === 50 && Object.keys(status.fees).length > 0, "/status exposes relayer address + per-pool fee quotes");

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
const fee = BigInt(status.fees[ethers.getAddress(pool1)]);

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

// token (pUSD) pools are allowlisted and relayed too
const tp = dep.contracts.tokens.pUSD.pools["10"];
const tPool = new UmbraPoolClient(tp, alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
const tDenom = await tPool.denomination();
const tNote = createNote(tDenom);
await tPool.deposit(tNote);
const tFresh = ethers.Wallet.createRandom().address;
const tFee = BigInt(status.fees[ethers.getAddress(tp)]);
const tp2 = await tPool.buildWithdraw(tNote, tFresh, status.relayer, tFee, ART);
const tr = await post({ poolAddress: tp, recipient: tFresh, a: tp2.a, b: tp2.b, c: tp2.c, root: tp2.root.toString(), nullifierHash: tp2.nullifierHash.toString() });
const pusdC = new ethers.Contract(dep.contracts.tokens.pUSD.address, ["function balanceOf(address) view returns (uint256)"], provider);
check(tr.status === 200 && (await pusdC.balanceOf(tFresh)) === tDenom - tFee, "relays a pUSD withdrawal (token pools allowlisted)");

// --- private balance (join-split pool): payments and withdrawals the user's wallet never signs ---
const TX_ART = { wasm: join(ROOT, "sdk/artifacts/transaction.wasm"), zkey: join(ROOT, "sdk/artifacts/transaction_final.zkey") };
const sp = dep.contracts.shieldedPool;
check(status.shielded && ethers.getAddress(status.shielded.pool) === ethers.getAddress(sp) && BigInt(status.shielded.fee) > 0n, "/status quotes a fee for the private pool");
const quote = await getRelayerQuote(R, { chainId: (await provider.getNetwork()).chainId, pool: sp });
const shielded = new UmbraShieldedClient(sp, alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
const me = new Keypair();
const bob = new Keypair();
const one = ethers.parseEther("1");
await shielded.transact({ inputs: [], outputs: [new Utxo({ amount: 5n * one, keypair: me })], owner: me, extAmount: 5n * one, artifacts: TX_ART }, alice);
check((await shielded.balance(me)) === 5n * one, "alice deposits 5 into her private balance (the one step her wallet signs)");

const postTx = async (prepared: { proof: any; ext: any }, patch: Record<string, unknown> = {}) => {
  const [args, extData] = UmbraShieldedClient.encodeArgs(prepared.proof, prepared.ext);
  const body = JSON.stringify({ args, extData: { ...extData, ...patch } }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const r = await fetch(`${R}/transact`, { method: "POST", headers: { "content-type": "application/json" }, body });
  return { status: r.status, json: (await r.json()) as any };
};
const pay = await shielded.planPayment({ source: "private", owner: me, to: bob.address(), amount: one, memo: "lunch", relay: quote });
const wrongRelayer = await shielded.prepare({ ...pay, relayer: ethers.Wallet.createRandom().address, artifacts: TX_ART });
check((await postTx(wrongRelayer)).status === 400, "refuses a proof bound to another relayer");
const lowFee = await shielded.prepare({ ...(await shielded.planPayment({ source: "private", owner: me, to: bob.address(), amount: one, relay: { ...quote, fee: quote.fee - 1n } })), artifacts: TX_ART });
check((await postTx(lowFee)).status === 400, "refuses a fee below its quote");
const good = await shielded.prepare({ ...pay, artifacts: TX_ART });
check((await postTx(good, { recipient: ethers.Wallet.createRandom().address })).status === 400, "refuses extData changed after proving (no gas spent)");
const dep2 = await shielded.prepare({ inputs: [], outputs: [new Utxo({ amount: one, keypair: me })], owner: me, extAmount: one, relayer: quote.relayer, fee: 0n, artifacts: TX_ART });
check((await postTx(dep2)).status === 400, "never funds deposits");

const nonceBefore = await provider.getTransactionCount(alice.address);
const poolBefore = await provider.getBalance(sp);
const r1 = await relayTransact(quote, good);
check(typeof r1.txHash === "string" && (await shielded.balance(bob)) === one, "relays a private payment: bob receives 1");
check((await shielded.balance(me)) === 4n * one - quote.fee, "alice's private balance pays the amount plus the relayer fee");
check(poolBefore - (await provider.getBalance(sp)) === quote.fee, "only the fee leaves the pool on a private payment");
check((await postTx(good)).status === 409, "replay rejected as already spent");

const fresh2 = ethers.Wallet.createRandom().address;
const wd = await shielded.prepare({ ...(await shielded.planWithdrawal(me, 2n * one, fresh2, quote)), artifacts: TX_ART });
await relayTransact(quote, wd);
check((await provider.getBalance(fresh2)) === 2n * one, "relays a withdrawal to a never-funded address");
check((await shielded.balance(me)) === 2n * one - 2n * quote.fee, "the withdrawal fee also comes from the private balance");
check((await provider.getTransactionCount(alice.address)) === nonceBefore, "alice's wallet signed neither relayed transaction");

console.log(`\nRELAYER SMOKE PASSED: ${n} checks`);
process.exit(0);
