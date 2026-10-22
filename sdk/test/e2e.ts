/*
 * Umbra end-to-end test against a real EVM (Anvil) using the REAL deploy pipeline:
 * circomlibjs Poseidon bytecode, snarkjs Groth16 verifiers, and this SDK.
 *
 *   anvil &                                   # or: make e2e (does all of this)
 *   NETWORK=local PRIVATE_KEY=<anvil key0> node scripts/deploy.js
 *   npx tsx sdk/test/e2e.ts
 *
 * Proves: on-chain Poseidon == poseidon-lite (roots match), real proofs verify on-chain,
 * double-spends revert, viewing keys reveal history without spend power, and the join-split
 * pool does deposit -> private transfer -> withdraw with correct balances.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  UmbraPoolClient,
  UmbraShieldedClient,
  createNote,
  commitment,
  nullifierHash,
  deriveViewingKey,
  encryptMemo,
  scanMemos,
  Keypair,
  Utxo,
  toEvmWei,
} from "../src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", "local.json"), "utf8"));
const RPC = process.env.E2E_RPC || "http://127.0.0.1:8545";
// Anvil's well-known dev accounts (local test keys only).
const KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const ART_W = {
  wasm: join(ROOT, "sdk", "artifacts", "withdraw.wasm"),
  zkey: join(ROOT, "sdk", "artifacts", "withdraw_final.zkey"),
};
const ART_T = {
  wasm: join(ROOT, "sdk", "artifacts", "transaction.wasm"),
  zkey: join(ROOT, "sdk", "artifacts", "transaction_final.zkey"),
};

let passed = 0;
function check(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAILED: " + msg);
  passed++;
  console.log("  ✔ " + msg);
}
async function expectRevert(p: Promise<unknown>, msg: string) {
  try {
    await p;
  } catch {
    passed++;
    console.log("  ✔ " + msg);
    return;
  }
  throw new Error("FAILED (did not revert): " + msg);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const alice = new ethers.Wallet(KEY0, provider);
  const relayer = new ethers.Wallet(KEY1, provider);

  // ---------------- fixed-denomination pool ----------------
  console.log("Fixed pool (1 tPOT):");
  const pool = new UmbraPoolClient(dep.contracts.pools["1"], alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
  const denom = await pool.denomination();
  check(denom === toEvmWei("1"), "denomination is 1 tPOT in 18-dec EVM units");

  // anonymity set: decoys + our note
  for (let i = 0; i < 2; i++) await pool.deposit(createNote(denom));
  const vk = await deriveViewingKey((m) => alice.signMessage(m), dep.chainId);
  const note = createNote(denom);
  const memo = encryptMemo(vk, {
    action: "deposit",
    denomination: denom.toString(),
    commitment: commitment(note).toString(16),
    nullifierHash: nullifierHash(note).toString(16),
    ts: Date.now(),
  });
  await pool.deposit(note, memo);
  check(true, "3 deposits landed (2 decoys + ours, with read-only memo)");

  // viewing key reveals our deposit but NOT spend secrets
  const deposits = await pool.scanDeposits();
  const disclosed = scanMemos(
    vk,
    deposits.filter((d) => d.encryptedMemo !== "0x").map((d) => ({ memo: ethers.getBytes(d.encryptedMemo) }))
  );
  check(disclosed.some((d) => d.memo.commitment === commitment(note).toString(16)), "viewing key discloses our deposit");
  check(
    disclosed.every((d) => !("secret" in d.memo) && !("nullifier" in d.memo)),
    "disclosed memos carry no spend secrets (C-01)"
  );
  let refused = false;
  try {
    encryptMemo(vk, { secret: "1" } as any);
  } catch {
    refused = true;
  }
  check(refused, "SDK refuses to encrypt spend secrets into a memo");

  // self-funded withdrawal to a brand-new address (Merkle root rebuilt locally == on-chain)
  const fresh = ethers.Wallet.createRandom().address;
  const proof = await pool.buildWithdraw(note, fresh, fresh, 0n, ART_W);
  await pool.withdrawSelf(proof, fresh, alice);
  check((await provider.getBalance(fresh)) === denom, "fresh recipient received exactly 1 tPOT via a real ZK proof");
  check(await pool.isSpent(note), "note marked spent");
  await expectRevert(pool.withdrawSelf(proof, fresh, alice), "double-spend of the same note reverts");

  // relayer-paid withdrawal with a proof-bound fee
  const note2 = createNote(denom);
  await pool.deposit(note2);
  const fresh2 = ethers.Wallet.createRandom().address;
  const fee = (denom * 50n) / 10_000n;
  const p2 = await pool.buildWithdraw(note2, fresh2, relayer.address, fee, ART_W);
  const poolAsRelayer = new ethers.Contract(dep.contracts.pools["1"], ["function withdraw(uint256[2],uint256[2][2],uint256[2],uint256,uint256,address,address,uint256,uint256)"], relayer);
  // a relayer that tries to raise its fee breaks the proof
  await expectRevert(
    poolAsRelayer.withdraw(p2.a, p2.b, p2.c, p2.root, p2.nullifierHash, fresh2, relayer.address, fee * 2n, 0),
    "relayer cannot inflate the fee (fee is bound into the proof)"
  );
  await (await poolAsRelayer.withdraw(p2.a, p2.b, p2.c, p2.root, p2.nullifierHash, fresh2, relayer.address, fee, 0)).wait();
  check((await provider.getBalance(fresh2)) === denom - fee, "relayer withdrawal pays recipient denom - fee");

  // ---------------- join-split pool ----------------
  console.log("Join-split pool:");
  const sp = new UmbraShieldedClient(dep.contracts.shieldedPool, alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
  const A = new Keypair();
  const B = new Keypair();

  await sp.transact({ inputs: [], outputs: [new Utxo({ amount: toEvmWei("5"), keypair: A })], owner: A, extAmount: toEvmWei("5"), artifacts: ART_T }, alice);
  check((await sp.balance(A)) === toEvmWei("5"), "deposit 5 tPOT into A's shielded balance");

  const [a5] = await sp.myUtxos(A);
  const toBob = new Utxo({ amount: toEvmWei("2"), keypair: Keypair.fromAddress(B.address()) });
  const change = new Utxo({ amount: toEvmWei("3"), keypair: A });
  await sp.transact({ inputs: [a5], outputs: [toBob, change], owner: A, extAmount: 0n, artifacts: ART_T }, alice);
  check((await sp.balance(A)) === toEvmWei("3"), "A privately sent 2 tPOT, kept 3 as change");
  check((await sp.balance(B)) === toEvmWei("2"), "B discovered 2 tPOT by scanning with only his keypair");

  const bobFresh = ethers.Wallet.createRandom().address;
  const [b2] = await sp.myUtxos(B);
  await sp.transact({ inputs: [b2], outputs: [], owner: B, extAmount: -toEvmWei("2"), recipient: bobFresh, artifacts: ART_T }, alice);
  check((await provider.getBalance(bobFresh)) === toEvmWei("2"), "B withdrew 2 tPOT to a brand-new address");
  check((await sp.balance(B)) === 0n, "B's shielded balance is now 0");

  // spending B's already-spent UTXO again must fail (prepare or chain)
  await expectRevert(
    sp.transact({ inputs: [b2], outputs: [], owner: B, extAmount: -toEvmWei("2"), recipient: bobFresh, artifacts: ART_T }, alice),
    "join-split double-spend reverts"
  );

  console.log(`\nE2E PASSED: ${passed} checks`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
