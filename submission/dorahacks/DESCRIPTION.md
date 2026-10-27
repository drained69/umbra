# Umbra — private payments on Portaldot

**Pay anyone. Hide everything.**
Umbra is a zero-knowledge privacy layer for payments, payment requests and swaps on Portaldot V3. Deposit once from any Portaldot wallet; from then on you can pay, request money, split bills and swap tPOT ↔ pUSD privately — the chain never learns who paid whom, or how much, and your wallet never signs a private payment.

> 🖼️ Upload image here: 01-cover.png

| | |
|---|---|
| 🌐 **Live app** | https://umbrav1.up.railway.app |
| 🎬 **Demo video (2 min)** | [YOUTUBE_LINK] |
| 💻 **Source code** | [GITHUB_LINK] |
| ⛓️ **Network** | Portaldot V3 testnet (EVM chain ID `420420777`) |
| 🏁 **Track** | Ecosystem DApps (+ Modular Cloud & Middleware) |
| 📌 **Status** | Live testnet beta · test tokens only · not independently audited |

---

## ⚡ TL;DR

- **One private balance for tPOT and pUSD.** Every user and every asset share a single shielded pool, so they all add to the same anonymity set.
- **Your wallet signs once.** You sign the deposit; after that a relayer submits your private payments, swaps and withdrawals, so your account never appears on chain for them.
- **Real zero-knowledge proofs.** Groth16 proofs are generated in your browser and verified on chain using Portaldot's BN254 precompiles.
- **Payments that feel like a modern wallet.** Private addresses, payment links and QR codes, bill splitting, and requests that mark themselves paid when a private payment arrives.
- **Private swaps on Portaldot's native exchange.** tPOT ↔ pUSD inside your private balance, settled atomically: either the swap fills at the quoted amount, or nothing happens.
- **Compliance-ready.** Read-only viewing keys let an accountant or auditor see your history without being able to spend.
- **It runs today.** Deployed on Portaldot V3 testnet; the first private swap was relayed live in block **215,680**.
- **Tested end to end.** 75 contract tests, 7 WASM tests, 30 end-to-end checks and 23 relayer checks with real proofs, plus live read-only suites against the testnet.

---

## 🔍 The problem

On a public chain, every payment is a permanent public record. Anyone can see who paid whom, how much, and when — and because one wallet is reused, a single payment exposes a person's entire financial history: their salary, their rent, the shops they use, the size of their savings.

For a chain built for payments and commerce, that is a blocker. People will not pay rent, salaries or suppliers on a ledger their landlord, employer and competitors can read. Businesses cannot expose their customers, margins or treasury. Portaldot's own whitepaper lists a **ZKP-based privacy protection suite** for compliant private commercial activity as a goal for the ecosystem.

> 🖼️ Upload image here: 02-problem-public-ledger.png

*On a public ledger, one wallet can be traced across every transfer it makes.*

---

## 💡 The solution

Umbra gives every Portaldot user a **private balance** next to their public one.

1. **Deposit** tPOT or pUSD from the Portaldot Extension or an EVM wallet. This is public, and it is the only step your wallet signs.
2. **Use it privately.** Pay a friend's private address, pay a request link, split a bill, or swap between tPOT and pUSD. Each action is a zero-knowledge proof generated in your browser and submitted by a relayer. The chain sees that a private transaction happened — not the sender, the recipient, the amount or the note.
3. **Withdraw at any time** to any address. The proof shows you own funds in the pool without revealing which deposit they came from.

Privacy is a choice, not a mode: the same app also makes ordinary public payments and swaps, and tells you before every action exactly what will be visible.

---

## 🎬 Demo walkthrough

**Watch the 2-minute demo:** [YOUTUBE_LINK]

All names, addresses and amounts in the screenshots below are example data.

### 1 · Create a private account

One click creates a private address (`umbra-addr-…`) and a private balance in tPOT and pUSD. A single spend key controls it; you back it up once, and it restores your balance in any browser. It can be remembered locally, encrypted with a passcode (PBKDF2-SHA256, AES-256-GCM).

> 🖼️ Upload image here: 04-private-account.png

### 2 · Deposit once

Your wallet signs the deposit in the Portaldot Extension. The app shows a live **privacy meter** — how many private transactions the pool has, and therefore how much cover you get — with a warning when the crowd is small.

> 🖼️ Upload image here: 05-deposit-one-signature.png

### 3 · Send privately — your wallet never signs

Paste a private address, enter an amount and an optional note. The note is encrypted so only the recipient can read it. The proof is generated in your browser, the relayer submits it, and your wallet is never asked to sign.

> 🖼️ Upload image here: 06-send-privately-relayer.png

### 4 · Get paid with a link

Create a payment link or QR code in tPOT or pUSD — nothing is published on chain until it is paid. Your friend opens the `?pay=` link, sees who is asking, how much, which asset and what for, and pays privately in one tap. The payment carries the request ID inside its encrypted note, so your app marks the request paid automatically. Splitting a bill creates one link per person, with shares that add up exactly to the total.

> 🖼️ Upload image here: 07-pay-a-request-link.png

### 5 · Swap without leaving your private balance

Swap tPOT ↔ pUSD at live prices from Portaldot's built-in exchange (`pallet-asset-conversion`). You see the rate, the relayer fee, the total and the price impact before you confirm. The relayer acts as the counterparty and buys the asset on the exchange in the same atomic transaction, and you receive exactly the quoted amount as a new private note.

> 🖼️ Upload image here: 08-private-swap-quote.png

### 6 · What the chain sees

The recipient finds the payment and its note in their private balance. The chain sees a verified proof submitted by the relayer — no sender, no recipient, no amount, no note.

> 🖼️ Upload image here: 09-what-the-chain-sees.png

---

## ⚙️ How it works

> 🖼️ Upload image here: 03-architecture.png

1. **Notes.** A private balance is a set of encrypted notes. Each note commits to `Poseidon(amount, publicKey, blinding, asset)` and is stored as a leaf in an on-chain Merkle tree. Its contents are encrypted to the owner (x25519 + XChaCha20-Poly1305), so only the owner can find and spend it. Encrypted outputs are padded to a fixed length, so a note with a memo looks the same as one without.
2. **Proofs.** A join-split transaction spends up to two notes and creates two new ones. The Groth16 circuit (`circuits/multiasset.circom`, ~27.5k constraints) proves the inputs exist and are unspent, that value is conserved per asset, and that the public data cannot be altered. The pool records each spent note's nullifier to prevent double spending.
3. **Relaying.** The relayer's address and fee are bound into the proof, so it cannot redirect funds or take more than the agreed fee. It checks every request exactly as the contract will, plus a local proof check, before it spends any gas. Its trust is liveness-only: it can refuse service, but it cannot steal, and users can always submit transactions themselves.
4. **Private swaps.** A swap proof spends notes of one asset and creates a note of the other for exactly the quoted amount. The pool pays the seller's input only to the proof's named counterparty, and only if it delivers the bought amount in the same call. The relayer buys that amount on the exchange first, in one atomic `utility.batchAll`.

### What each action reveals

| Action | Hidden | Visible on chain |
|---|---|---|
| Deposit into the private balance | Which notes the deposit becomes | Depositor's account, asset and amount |
| Private payment (relayed) | Sender, recipient, amount, note | That a private transaction happened; the relayer |
| Private swap (relayed) | Who traded; their balance and history | The relayer's trade on the exchange, including its size |
| Withdrawal (relayed) | Which deposit the funds came from | Amount and the receiving address; the relayer |
| Request link | Everything, until it is paid | Nothing — the link is never published |

---

## 🧩 Built for Portaldot V3

Portaldot V3 runs two virtual machines on one chain — EVM (`pallet-revive`) and WASM (`pallet-contracts`) — next to native runtime pallets. Umbra composes all of them, and every capability below was measured on the live runtime and is re-checked by a command in the repo.

| Portaldot capability | How Umbra uses it |
|---|---|
| `pallet-revive` (EVM bytecode) | Shielded pools, Merkle trees, Groth16 verifiers and the Poseidon hasher are EVM contracts |
| BN254 precompiles `0x06` / `0x07` / `0x08` | On-chain Groth16 verification |
| `revive.call` from native accounts | Portaldot Extension users deposit and withdraw with their `5…` account — no EVM wallet needed |
| `revive.mapAccount` + `utility.batchAll` | Account mapping and the first deposit in a single signature |
| `pallet-assets` ERC-20 precompile | Shield any Portaldot asset; pUSD (asset #7777) gives confidential stablecoin payments |
| `pallet-asset-conversion` | Live swap quotes and the private swap venue |
| `ReviveApi` dry-runs | Exact weight and storage-deposit limits, and revert reasons, before the user signs |
| `pallet-contracts` (ink! / WASM) | A second Groth16 verifier (arkworks) that checks the same proofs byte for byte |

**Designed around Portaldot's storage economics.** On Portaldot, every new storage slot locks a deposit charged to the signer. The contracts were redesigned so deposits allocate no new storage at all — hard-coded Poseidon zero hashes, a pre-initialised tree and a root ring buffer — bringing a fixed-pool deposit from **8.96 tPOT to 0** and a private transaction from **12.8 to 7.68 tPOT** of storage deposit, measured with live dry-runs.

**A cross-VM verifier.** An ink! coprocessor verifies the same Groth16 proofs as the EVM verifier, as an independent second check (about 0.035 s of block weight on the EVM verifier vs about 0.3 s on WASM, measured on testnet). It is built, tested and dry-run on testnet; deployment is on the roadmap.

---

## ✨ Features

**Private balance**
- One shielded pool for tPOT and pUSD; deposit from any Portaldot wallet, then send, swap and withdraw through the relayer
- One spend key restores the balance anywhere; optional passcode-encrypted storage in the browser

**Payments, requests and bill splitting**
- Pay any private address in tPOT or pUSD with an encrypted note only the recipient can read
- Payment links and QR codes; private requests share only your private address
- Requests settle automatically when a private payment carrying their ID arrives
- Public payments produce a receipt link the requester can verify on chain (the payment and the request ID must be in the same transaction)
- Split a bill into one link per person; shares add up exactly to the total
- Ordinary public payments to `5…` and `0x` addresses are supported too

**Swaps**
- Private swaps tPOT ↔ pUSD inside the private balance, atomic, at live exchange prices
- Ordinary wallet swaps with slippage limit, minimum received and price-impact warnings

**Shielded pools and selective disclosure**
- Fixed-size pools (100 / 1,000 tPOT and pUSD) for simple deposit-and-withdraw privacy
- Read-only viewing keys for accountants and auditors

**Product quality**
- Works with the Portaldot Extension (native `5…` accounts) or EVM wallets
- Privacy meter with warnings when the anonymity set is small
- Every action explains what is hidden and what is visible before you confirm
- Self-hosted fonts and no third-party requests; responsive layout with light and dark themes

---

## 🧪 Proof that it works

| Layer | Evidence |
|---|---|
| Contracts | **75 Foundry tests** with the real Poseidon bytecode: real Groth16 proofs, on-chain roots equal SDK roots, storage properties, the multi-asset pool's swap rules, audit regressions |
| WASM verifier | **7 tests**: verifies the same real proofs as Solidity; rejects tampered, off-curve and non-canonical inputs |
| Full system on a local chain | **30 end-to-end checks** with real proofs through the real deploy pipeline (fixed pools, join-split, private swaps in both directions, counterparty binding, tampered amounts) and **23 relayer checks** (relayed payments and withdrawals, tampering, low fees, replays, the user's wallet never signing) |
| Live testnet (read-only) | **15 preflight checks**, plus live suites for native accounts (14), payments and requests (27), cross-VM (6), event indexing (5) and the deployed multi-asset pool (5, including a real proof accepted by the deployed verifier) |
| Proving keys ↔ verifiers | SHA-256 pinned in an artifact manifest and checked in CI |

**Verified live:** the first private swap was submitted by the relayer in block **215,680** as one `utility.batchAll` (exchange trade, pUSD approval, pool call), after a deposit from the user's own account in block 215,672.

---

## 📜 Deployed contracts (Portaldot V3 testnet)

| Contract | Address |
|---|---|
| Multi-asset private pool (private balance, payments, swaps) | `0x341bE1d79E763A1Bd68f0FFccb330Ae75Da499fc` |
| Multi-asset Groth16 verifier | `0x6124AC4b8eCE30665f8F01831916beb427BdB16c` |
| Single-asset private pool (first version, still withdrawable) | `0x499298029680abB438bBABd39461805b8EA86d45` |
| Join-split Groth16 verifier | `0x9e7e6C9c3Af320249803B5794412C6fAC78ea564` |
| 100 tPOT pool | `0x9346d060Df4035d242c42FA5fcEC93b49F17e7Fb` |
| 1,000 tPOT pool | `0x1978CdaA0CCE0219a1D63bFf8eBfa5EdE50F1442` |
| 100 pUSD pool | `0x66485EC9B55B8d18f13B9Da788DAD0e5E581fC7a` |
| 1,000 pUSD pool | `0xfE94fa026bE1BdfeFD23c8C39DF8241704b1Db91` |
| Withdraw Groth16 verifier | `0x624C510f204011F0347c2ba0939acFB629824661` |
| Poseidon(2) hasher | `0x5C4e3060A45F8c6985166e74c1B513A10Aa727A1` |

Relayer: https://umbra-relayer-production.up.railway.app (`/status`, `/health`). All contracts were deployed from the Portaldot Extension via `revive.instantiateWithCode`.

---

## 🛠️ Tech stack

- **Zero-knowledge:** circom 2.1 circuits with circomlib (withdraw, join-split, multi-asset), Groth16 via snarkjs 0.7, Poseidon hashing
- **Smart contracts:** Solidity 0.8.24 on `pallet-revive`, Foundry for testing, Groth16 verifiers on Portaldot's BN254 precompiles
- **WASM verifier:** ink! 5 with arkworks 0.4 (`ark-bn254`, `ark-groth16`)
- **SDK:** TypeScript — notes, keys, Merkle trees, provers, pool clients, payments, swaps and a relayer client; ethers v6, `@polkadot/api` 17, `@noble` cryptography
- **Relayer:** Node.js + Express; native and EVM accounts; Docker image
- **Frontend:** React 18 + Vite + TypeScript; Portaldot Extension via `@polkadot/extension-dapp`, or any EVM wallet
- **Cryptography:** x25519 + XChaCha20-Poly1305 note encryption; PBKDF2-SHA256 + AES-256-GCM for the optional stored spend key
- **Infrastructure:** app and relayer on Railway; CI runs the Foundry tests, the proving-key/verifier pins, the WASM verifier tests and `no_std` wasm32 build, the SDK and app typecheck and build, the full end-to-end suite (local chain + real deploy + relayer), and the live read-only testnet suites

---

## 💰 Business model and ecosystem value

- **Revenue built in:** relayer fees on private transactions and a spread on private swaps.
- **A reusable privacy primitive for Portaldot:** a multi-asset shielded pool any Portaldot asset can join, a TypeScript SDK, and a relayer other Portaldot dApps can plug into — so wallets, payroll tools, marketplaces and RWA platforms can add private payments without building their own ZK stack.
- **Compliance by design:** viewing keys give regulators, auditors and accountants read-only access, which is what lets private payments work for real businesses.
- **Network effect:** every new user and every new asset strengthens everyone's privacy, because they all share one anonymity set.

---

## 🔐 Security and honest limitations

- **Not independently audited.** The code has had two internal review passes, with findings fixed and covered by regression tests. Test tokens only — do not use it with real funds.
- **Trusted setup.** The proving keys come from a single-contributor setup, suitable for a demo; production needs a multi-party ceremony.
- **Relayer.** It can delay or refuse service, but cannot redirect funds or raise its fee. Users can always submit transactions themselves, at the cost of revealing their account.
- **Anonymity set.** Privacy depends on how many people use the pool; the privacy meter makes this visible instead of hiding it.
- **Swap amounts** are visible on the exchange, though not linked to the trader.
- **Costs on testnet.** Each private transaction locks about 7.7 tPOT of storage deposit for its two nullifiers; the relayer's default fee (9 tPOT, or the pUSD equivalent) covers it.

---

## 🗺️ Roadmap

- **Batched private swaps** that hide individual amounts by netting many traders' orders
- **Multi-party trusted setup** and an independent audit before any real-funds deployment
- **WASM verifier deployment** on testnet, for a cross-VM second check on every proof
- **Cross-chain transfers** between Ethereum Sepolia and Portaldot (an operator-trusted prototype is implemented and locally tested)
- **Mainnet:** Portaldot V3 Live runs the same EVM-capable runtime

---

## 🏆 Why Umbra should win

- **Innovation:** one app composes EVM contracts, native runtime pallets and a WASM verifier. Private payments settle requests through encrypted notes; private swaps settle atomically against Portaldot's native exchange with the relayer as counterparty, so the trader never appears on chain. Viewing keys add selective disclosure.
- **Technical feasibility:** real circuits and real Groth16 proofs verified on chain, a private swap verified live on testnet, and a test suite that covers contracts, the WASM verifier, the full system and the live network.
- **Ecosystem contribution:** it delivers the ZKP privacy suite Portaldot's whitepaper calls for, as a reusable pool, SDK and relayer the rest of the ecosystem can build on.
- **User experience:** private payments that feel like a modern payments app — links, QR codes, bill splits and swaps — usable straight from the Portaldot Extension, with honest privacy guidance at every step.

> 🖼️ Upload image here: 10-under-the-hood.png

**Try it now: https://umbrav1.up.railway.app**

*Built for the Portaldot Hacker House 2026. MIT licensed (the snarkjs-generated verifier contracts are GPL-3.0).*
