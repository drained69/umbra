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
  UmbraMultiAssetClient,
  MULTI_ASSET_POOL_ABI,
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

  // ---------------- shielded Portaldot asset (pUSD; mock ERC-20 locally) ----------------
  console.log("Asset pool (100 pUSD):");
  const pusdInfo = dep.contracts.tokens.pUSD;
  const pusdPool = new UmbraPoolClient(pusdInfo.pools["100"], alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
  const pusd = new ethers.Contract(pusdInfo.address, ["function balanceOf(address) view returns (uint256)"], provider);
  const pDenom = await pusdPool.denomination();
  check(pDenom === 100n * 10n ** 6n && (await pusdPool.token()) === pusdInfo.address, "pUSD pool: 100 pUSD (6 decimals), token() is the asset");
  for (let i = 0; i < 2; i++) await pusdPool.deposit(createNote(pDenom)); // decoys
  const pNote = createNote(pDenom);
  const aliceBefore = await pusd.balanceOf(alice.address);
  await pusdPool.deposit(pNote); // approve + deposit
  check(aliceBefore - (await pusd.balanceOf(alice.address)) === pDenom, "deposit pulled exactly 100 pUSD (approve + deposit)");
  const pFresh = ethers.Wallet.createRandom().address;
  const pFee = (pDenom * 50n) / 10_000n;
  const pp = await pusdPool.buildWithdraw(pNote, pFresh, relayer.address, pFee, ART_W);
  const pusdPoolAsRelayer = new ethers.Contract(pusdInfo.pools["100"], ["function withdraw(uint256[2],uint256[2][2],uint256[2],uint256,uint256,address,address,uint256,uint256)"], relayer);
  const relayerPusdBefore = await pusd.balanceOf(relayer.address);
  await (await pusdPoolAsRelayer.withdraw(pp.a, pp.b, pp.c, pp.root, pp.nullifierHash, pFresh, relayer.address, pFee, 0)).wait();
  check((await pusd.balanceOf(pFresh)) === pDenom - pFee, "fresh recipient got 99.5 pUSD via a real ZK proof (same circuit)");
  check((await pusd.balanceOf(relayer.address)) - relayerPusdBefore === pFee, "relayer fee paid in pUSD");

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

  // ---------------- multi-asset pool: tPOT + pUSD in one private balance, private swaps ----------------
  console.log("Multi-asset pool:");
  const ART_M = { wasm: join(ROOT, "sdk", "artifacts", "multiasset.wasm"), zkey: join(ROOT, "sdk", "artifacts", "multiasset_final.zkey") };
  const maAddr = dep.contracts.multiAssetPool.address;
  const ma = new UmbraMultiAssetClient(maAddr, alice, { deployBlock: dep.deployBlock, chunkSize: 50 });
  const TP = 0n, PU = 1n;
  const pu = (x: string) => ethers.parseUnits(x, 6);
  const maUsd = new ethers.Contract(dep.contracts.multiAssetPool.assets[1].address, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"], alice);
  const C = new Keypair();
  const D = new Keypair();
  const bal = async (k: Keypair) => UmbraMultiAssetClient.balances(await ma.myNotes(k));

  await ma.transact(ma.planDeposit(C, TP, toEvmWei("10")), ART_M, alice);
  await ma.transact(ma.planDeposit(C, PU, pu("300")), ART_M, alice);
  let bc = await bal(C);
  check(bc.get(TP) === toEvmWei("10") && bc.get(PU) === pu("300"), "one private balance holds 10 tPOT and 300 pUSD");

  await ma.transact(await ma.planPayment({ owner: C, to: D.address(), asset: PU, amount: pu("100"), memo: "rent" }), ART_M, alice);
  const dNotes = await ma.myNotes(D);
  check(UmbraMultiAssetClient.balances(dNotes).get(PU) === pu("100") && dNotes[0].utxo.memo === "rent", "private pUSD payment, with its encrypted note, reaches D");

  // the relayer (counterparty) holds pUSD and delivers it in the same call
  await (await maUsd.transfer(relayer.address, pu("200"))).wait();
  await (await (maUsd.connect(relayer) as ethers.Contract).approve(maAddr, pu("200"))).wait();
  const terms = { relayer: relayer.address, fee: toEvmWei("0.1") };
  const sell = await ma.prepare(await ma.planSwap({ owner: C, sell: TP, buy: PU, amountIn: toEvmWei("4"), amountOut: pu("50"), relay: terms }), ART_M);
  const [sArgs, sExt] = UmbraMultiAssetClient.encodeArgs(sell.proof, sell.ext);
  const maAsRelayer = new ethers.Contract(maAddr, MULTI_ASSET_POOL_ABI, relayer);
  const maAsAlice = new ethers.Contract(maAddr, MULTI_ASSET_POOL_ABI, alice);
  await expectRevert(maAsAlice.transact(sArgs, sExt).then((t: any) => t.wait()), "only the named counterparty can execute a swap proof");
  await expectRevert(maAsRelayer.transact({ ...sArgs, swapAmount: pu("51") }, sExt).then((t: any) => t.wait()), "a swap amount changed after proving fails the real verifier");
  const poolNativeBefore = await provider.getBalance(maAddr);
  const relayerUsdBefore: bigint = await maUsd.balanceOf(relayer.address);
  await (await maAsRelayer.transact(sArgs, sExt)).wait();
  bc = await bal(C);
  check(bc.get(TP) === toEvmWei("5.9") && bc.get(PU) === pu("250"), "private swap: C sold 4 tPOT (+0.1 fee) for a new 50 pUSD note");
  check(poolNativeBefore - (await provider.getBalance(maAddr)) === toEvmWei("4.1") && relayerUsdBefore - (await maUsd.balanceOf(relayer.address)) === pu("50"), "the counterparty was paid 4.1 tPOT for delivering 50 pUSD");

  const buy = await ma.prepare(await ma.planSwap({ owner: C, sell: PU, buy: TP, amountIn: pu("20"), amountOut: toEvmWei("1"), relay: { relayer: relayer.address, fee: pu("0.5") } }), ART_M);
  const [bArgs, bExt] = UmbraMultiAssetClient.encodeArgs(buy.proof, buy.ext);
  await expectRevert(maAsRelayer.transact(bArgs, bExt, { value: toEvmWei("0.9") }).then((t: any) => t.wait()), "short native delivery reverts");
  await (await maAsRelayer.transact(bArgs, bExt, { value: UmbraMultiAssetClient.valueFor(buy.proof, buy.ext) })).wait();
  bc = await bal(C);
  check(bc.get(TP) === toEvmWei("6.9") && bc.get(PU) === pu("229.5"), "reverse swap: C sold 20 pUSD (+0.5 fee) for 1 tPOT");

  const dOut = ethers.Wallet.createRandom().address;
  await expectRevert(ma.planWithdrawal(D, PU, pu("100"), dOut).then((p) => ma.prepare(p, ART_M)), "refuses a pUSD withdrawal to an account without tPOT");
  await (await alice.sendTransaction({ to: dOut, value: toEvmWei("1") })).wait();
  await ma.transact(await ma.planWithdrawal(D, PU, pu("100"), dOut), ART_M, alice);
  check((await maUsd.balanceOf(dOut)) === pu("100"), "D withdrew 100 pUSD");

  console.log(`\nE2E PASSED: ${passed} checks`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
