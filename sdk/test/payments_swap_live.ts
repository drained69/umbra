/*
 * Payments, requests and native-DEX swaps (offline + read-only live; nothing is signed):
 *   cd sdk && npx --yes tsx@4.19.1 test/payments_swap_live.ts
 */
import { ApiPromise, WsProvider } from "@polkadot/api";
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { keccak_256 } from "@noble/hashes/sha3";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";
import { ethers } from "ethers";
import {
  Keypair,
  Utxo,
  UmbraShieldedClient,
  createRequest,
  decodeRequest,
  decodeReceipt,
  encodeReceipt,
  encodeRequest,
  parseMemo,
  publicTransferCalls,
  quoteExactIn,
  quoteExactOut,
  requestLink,
  requestMemo,
  requestRemark,
  resolveAccount,
  splitAmount,
  swapCall,
  toUnits,
  verifyReceipt,
  type PaymentRequest,
} from "../src/index";

const WS = process.env.PORTALDOT_WS ?? "wss://test-node-v3.portaldot.dev";
const ME = "5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8"; // public testnet account (read-only use)
const ME_EVM = "0x25a1F91BC0bBd2c87AbDF6fcDDabFACe5B69BAA7";
const PUSD = { symbol: "pUSD", assetId: 7777, decimals: 6 };
const TPOT = { symbol: "tPOT", assetId: null, decimals: 18 };
let n = 0;
const check = (c: boolean, m: string) => {
  if (!c) throw new Error("FAILED: " + m);
  n++;
  console.log("  ✔ " + m);
};
const throws = (f: () => unknown, m: string) => {
  try {
    f();
  } catch {
    return check(true, m);
  }
  check(false, m);
};

// --- encrypted memos
const bob = new Keypair();
const withMemo = new Utxo({ amount: 5n * 10n ** 18n, keypair: bob, memo: requestMemo("0123456789abcdef", "Dinner 🍕") });
const plain = new Utxo({ amount: 7n, keypair: bob });
const c1 = withMemo.encryptTo(bob.encPublic);
const c2 = plain.encryptTo(bob.encPublic);
check(c1.length === c2.length, `ciphertexts are the same length with or without a memo (${c1.length} bytes)`);
const back = Utxo.decrypt(c1, bob, 3)!;
check(back.amount === withMemo.amount && back.commitment() === withMemo.commitment(), "a memo note decrypts to the same commitment");
check(parseMemo(back.memo).requestId === "0123456789abcdef" && parseMemo(back.memo).text === "Dinner 🍕", "the memo carries the request id and text");
check(Utxo.decrypt(c1, new Keypair(), 3) === null, "only the recipient can read the memo");
throws(() => new Utxo({ amount: 1n, keypair: bob, memo: "x".repeat(97) }), "memos over 96 bytes are rejected");
const escaped = new Utxo({ amount: 1n, keypair: bob, memo: '"'.repeat(96) });
check(Utxo.decrypt(escaped.encryptTo(bob.encPublic), bob, 0)!.memo === '"'.repeat(96), "a worst-case escaped memo still fits the padding");

// notes created before memos (unpadded JSON) still decrypt
{
  const eph = x25519.utils.randomPrivateKey();
  const key = keccak_256(x25519.getSharedSecret(eph, bob.encPublic));
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const legacy = new TextEncoder().encode(JSON.stringify({ amount: "2a", blinding: "1f" }));
  const ct = xchacha20poly1305(key, nonce).encrypt(legacy);
  const blob = new Uint8Array([...x25519.getPublicKey(eph), ...nonce, ...ct]);
  const u = Utxo.decrypt(blob, bob, 0)!;
  check(u.amount === 42n && u.memo === undefined, "legacy (pre-memo) notes still decrypt");
}

// --- requests, links, splits
const req = createRequest({ chainId: 420420777, asset: TPOT, amount: "12.5", to: { shielded: bob.address(), account: ME }, name: "Alice", memo: "Dinner" });
const link = requestLink("https://umbra.example/app?x=1#y", req);
check(new URL(link).searchParams.get("pay") === encodeRequest(req), "request link carries only the encoded request");
check(JSON.stringify(decodeRequest(encodeRequest(req))) === JSON.stringify(req), "request round-trips through its link");
throws(() => decodeRequest(encodeRequest(req).slice(0, -6)), "a truncated link is rejected");
const pusdReq = createRequest({ chainId: 420420777, asset: PUSD, amount: "2.5", to: { shielded: bob.address() }, memo: "Lunch" });
check(decodeRequest(encodeRequest(pusdReq)).asset.assetId === 7777 && !decodeRequest(encodeRequest(pusdReq)).to.account, "a private pUSD request round-trips with only the private address");
throws(() => createRequest({ chainId: 1, asset: PUSD, amount: "1", to: { shielded: "umbra-addr-00" } }), "a malformed private address is rejected");
throws(() => createRequest({ chainId: 1, asset: TPOT, amount: "0", to: { account: ME } }), "zero-amount requests are rejected");
throws(() => toUnits("1.0000001", 6), "amounts with more precision than the asset are rejected");
const shares = splitAmount("10", 6, 3);
check(shares.reduce((s, x) => s + toUnits(x, 6), 0n) === 10_000_000n && shares[0] === "3.333334", `split 10 pUSD three ways: ${shares.join(" + ")}`);
const receipt = { v: 1 as const, id: req.id, chainId: 420420777, blockHash: "0x" + "ab".repeat(32) };
check(JSON.stringify(decodeReceipt(encodeReceipt(receipt))) === JSON.stringify(receipt), "receipt round-trips");

// --- live
const api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
try {
  const remark = new TextEncoder().encode(requestRemark(req.id));
  check(api.registry.hash(remark).toHex() === "0x" + bytesToHex(blake2b(remark, { dkLen: 32 })), "remark hash matches the runtime's hasher");

  const q = await quoteExactIn(api, "native", 7777, 10n ** 14n, 100);
  check(q.amountOut > 0n && q.limit === (q.amountOut * 9900n) / 10000n, `1 tPOT quotes ${Number(q.amountOut) / 1e6} pUSD (min ${Number(q.limit) / 1e6} at 1% slippage)`);
  check(q.feeBps === 30 && q.priceImpactBps > 30 && q.priceImpactBps < 200, `fee 0.30%, price impact ${(q.priceImpactBps / 100).toFixed(2)}%`);
  const qo = await quoteExactOut(api, 7777, "native", 10n ** 14n, 100);
  check(qo.amountIn > 0n && qo.limit > qo.amountIn, `1 tPOT costs ${Number(qo.amountIn) / 1e6} pUSD (max ${Number(qo.limit) / 1e6})`);
  const fee1 = (await api.tx.utility.batchAll([swapCall(api, q, ME)]).paymentInfo(ME)).partialFee.toBigInt();
  check(fee1 > 0n, `swap extrinsic is accepted by the runtime for fee estimation (${Number(fee1) / 1e14} tPOT)`);

  const shielded = new UmbraShieldedClient("0x499298029680abB438bBABd39461805b8EA86d45", new ethers.JsonRpcProvider("https://test-evm-rpc-v3.portaldot.dev", 420420777, { staticNetwork: true }), { deployBlock: 169320 });
  const wallet = await shielded.planPayment({ source: "wallet", owner: null, to: bob.address(), amount: 10n ** 18n, memo: requestMemo(req.id) });
  check(wallet.extAmount === 10n ** 18n && wallet.inputs.length === 0 && wallet.outputs[0].memo === requestMemo(req.id), "pay-from-wallet plan deposits straight into the payee's note");
  let insufficient = false;
  await shielded.planPayment({ source: "private", owner: new Keypair(), to: bob.address(), amount: 1n }).catch(() => (insufficient = true));
  check(insufficient, "pay-from-private-balance refuses when the balance is short");

  check((await resolveAccount(api, ME_EVM)) === ME, "a 0x address resolves to its mapped Portaldot account");
  for (const [label, assetId, amount] of [["tPOT", null, 10n ** 13n], ["pUSD", 7777, 1_000_000n]] as const) {
    const calls = publicTransferCalls(api, { assetId, to: "5DUcqxwH6oipKutbTsRJ6Fcgskozi5nkxVsv4DhA87FQKbdD", amount, requestId: req.id });
    const fee = (await api.tx.utility.batchAll(calls).paymentInfo(ME)).partialFee.toBigInt();
    check(calls.length === 2 && fee > 0n, `public ${label} payment + request remark encodes for the runtime`);
  }

  const head = await api.rpc.chain.getBlockHash();
  const publicReq: PaymentRequest = { ...req, to: { account: ME } };
  check((await verifyReceipt(api, publicReq, { v: 1, id: req.id, chainId: 420420777, blockHash: head.toHex() })) === null, "a receipt for an unrelated block does not verify");
} finally {
  await api.disconnect();
}
console.log(`\n${n} checks passed`);
