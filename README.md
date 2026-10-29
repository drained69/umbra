# Umbra

**A testnet zero-knowledge privacy layer for payments, merchant checkout and swaps on Portaldot V3.**

Umbra is a testnet app, SDK and relayer built around a multi-asset shielded pool. Users can deposit tPOT or pUSD, pay private addresses, request and split payments, swap assets within their private balance, and withdraw. Merchants can sell digital products through Umbra Checkout: a hosted pUSD storefront with an order dashboard and downloads gated by finalized payment verification.

The browser generates zero-knowledge proofs that Portaldot verifies on chain. By default, the relayer submits private spends without a wallet signature; **deposits still reveal the depositor, asset and amount, while withdrawals reveal the destination and amount**. See the [privacy model](#privacy-model) before using it.

| | |
|---|---|
| **Live app** | [umbrav1.up.railway.app](https://umbrav1.up.railway.app/) |
| **Merchant checkout** | [Create a storefront](https://umbrav1.up.railway.app/?merchant=1) · [Integration guide](docs/CHECKOUT.md) |
| **Demo** | [Two-minute video](https://www.youtube.com/watch?v=hMTj8YFXGWM) |
| **Network** | Portaldot V3 testnet (EVM chain ID `420420777`) |
| **Status** | Testnet beta with valueless test assets; internally reviewed, not independently audited |

### New: Umbra Checkout

Umbra Checkout gives creators a way to sell a digital product and receive pUSD in their private account. Create a hosted storefront, share its link or QR code, and follow orders from a merchant dashboard. Customers can pay from a private balance or a connected wallet; the text download becomes available only after the server verifies the matching payment in finalized pool events.

**Try it:** open [Umbra Checkout](https://umbrav1.up.railway.app/?merchant=1), choose **Use sample product**, enter your private receiving address, and create a storefront. Save both the merchant backup and your private-account spend key; they serve different purposes. See [the full checkout walkthrough](#umbra-checkout) for fees, recovery, privacy and current limitations.

---

## Contents

1. [What is live](#what-is-live)
2. [Features](#features)
3. [Privacy model](#privacy-model)
4. [How it works](#how-it-works)
5. [Why Portaldot V3](#why-portaldot-v3)
6. [Using the app](#using-the-app)
7. [Umbra Checkout](#umbra-checkout)
8. [Deployed contracts](#deployed-contracts)
9. [Development](#development)
10. [Running the relayer](#running-the-relayer)
11. [Testing and verification](#testing-and-verification)
12. [Costs and units](#costs-and-units)
13. [Security and limitations](#security-and-limitations)
14. [Roadmap](#roadmap)
15. [Repository layout](#repository-layout)
16. [License](#license)

---

## What is live

| Component | Current status |
|---|---|
| Multi-asset private pool and Groth16 verifier | Deployed on Portaldot V3 testnet; supports tPOT and pUSD |
| Web app and relayer | Live on Railway; the app supports native Portaldot and EVM wallets |
| Umbra Checkout | Live on Railway with persistent order storage; pUSD storefronts, merchant dashboard, verified text downloads |
| Private swap | Executed on testnet in block 215,680 through one atomic native batch |
| Fixed-size pools and first-version shielded pool | Deployed; earlier notes remain withdrawable |
| WASM coprocessor | Built, tested and dry-run on testnet; **not deployed** |
| Sepolia → Portaldot bridge | Operator-trusted prototype, locally tested; **not deployed as a live bridge** |

The live app is a demonstration, not a production privacy guarantee. Contract addresses, test evidence and the limits of each component are documented below.

## Features

**Private balance (tPOT and pUSD)**
- One private account holds tPOT and pUSD notes in a shared shielded pool. Asset information and a small user population still limit the effective anonymity set.
- Deposit from a connected native or EVM wallet; send, swap and withdraw through the relayer by default, or self-submit where supported.
- One spend key, backed up once, restores the balance in any browser. The key can be remembered locally, encrypted with a passcode (PBKDF2-SHA256, AES-256-GCM).

**Private payments**
- Pay a private address (`umbra-addr-…`) in tPOT or pUSD. The recipient can decrypt the received amount and optional note.
- For a relayed payment, the sender's wallet address is not included in the spend transaction. Timing and network metadata can still weaken privacy.
- Payments to ordinary `5…` or `0x` addresses are also supported, publicly.

**Requests and bill splitting**
- Create a payment link or QR code in tPOT or pUSD. Nothing is published on chain until it is paid.
- Private requests share only your private address, unless you choose to also accept public payment.
- A private payment carries the request ID inside its encrypted note, so the requester's app marks the request paid automatically.
- A public payment produces a receipt link the requester can verify on chain: the payment and the request ID must be in the same transaction.
- Split a bill into one link per person; shares add up exactly to the total.

**Private swaps**
- Swap tPOT ↔ pUSD inside the private balance at live prices from Portaldot's built-in exchange (`pallet-asset-conversion`).
- The relayer acts as the counterparty and buys the asset on the exchange in the same atomic transaction. The trader's wallet never signs, and either the swap fills at the quoted amount or nothing happens.
- Ordinary wallet-to-wallet swaps are also available.

**Umbra Checkout**
- Create a pUSD digital-product storefront with a payment link, QR code and embeddable link button.
- Track orders in a merchant dashboard; download and restore merchant access backups.
- Release a text download only after the server verifies the exact merchant-encrypted payment note in finalized pool events.
- Includes a sample *Umbra Field Notes* product. Checkout discloses order details to the operator and requires persistent server storage. See [setup, verification and privacy details](docs/CHECKOUT.md).

**Shielded pools and viewing keys**
- Fixed-size pools (100 / 1,000 tPOT and pUSD) for simple deposit-and-withdraw privacy.
- Read-only viewing keys let an accountant or auditor inspect your history without being able to spend.

**Product quality**
- Works with the Portaldot Extension (native `5…` accounts) or EVM wallets.
- Privacy meter showing how much cover the pool currently gives, with warnings when it is low.
- Self-hosted fonts, no third-party analytics or font CDN, and a responsive light and dark interface. The app does contact Portaldot RPC endpoints and the Umbra relayer.

## Privacy model

What each action reveals on chain:

| Action | Hidden | Visible on chain |
|---|---|---|
| Deposit into the private balance | Which notes the deposit becomes | Depositor's account, asset and amount |
| Private payment (relayed) | Wallet address, recipient, amount, note inside the pool | That a private transaction happened; the relayer and its fee |
| Private payment (self-submitted) | Recipient, amount and note inside the pool | The user's wallet as transaction submitter |
| Private swap (relayed) | Who traded; their balance and history | The relayer's trade on the exchange, including its size |
| Withdrawal (relayed) | Which deposit the funds came from | Amount and the receiving address; the relayer |
| Request link | No on-chain request record until payment | Nothing; anyone given the off-chain link can see its request details |

Privacy is only as strong as the crowd: with few users, timing and amounts can link activity. The relayer may see the submitter's IP address and the timing of their request. The app shows pool activity with a privacy meter. Hiding individual swap sizes would require batching traders together; that design is in [`docs/PRIVATE_SWAPS.md`](docs/PRIVATE_SWAPS.md).

## How it works

```
 Browser (React app + SDK)                         Portaldot V3 testnet
 ┌────────────────────────────┐                    ┌────────────────────────────────────┐
 │ spend key + encrypted notes│                    │ EVM (pallet-revive)                │
 │ Groth16 prover (snarkjs)   │── deposit ────────▶│  UmbraMultiAssetPool  ◀─ verifier  │
 │                            │   (wallet signs)   │  Merkle tree, nullifiers, assets   │
 │                            │                    │                                    │
 │ proof + relay terms        │── HTTPS ─▶ Relayer │ Native runtime                     │
 └────────────────────────────┘   (no signature)  ─┼▶ utility.batchAll:                 │
                                                   │   assetConversion swap  (if swap)  │
                                                   │   pUSD approve          (if swap)  │
                                                   │   revive.call pool.transact        │
                                                   └────────────────────────────────────┘
```

1. **Notes.** A balance is a set of encrypted notes. Each note commits to `Poseidon(amount, publicKey, blinding, asset)` and is stored as a leaf in an on-chain Merkle tree. Its plaintext is encrypted to the owner (x25519 + XChaCha20-Poly1305), so only the owner can find and spend it.
2. **Proofs.** A join-split transaction spends up to two notes and creates two new ones. The Groth16 circuit ([`circuits/multiasset.circom`](circuits/multiasset.circom), ~27.5k constraints) proves the inputs exist and are unspent, value is conserved per asset, and the public data cannot be altered. The pool records each spent note's nullifier to prevent double spending.
3. **Relaying.** The relayer's address and fee are bound into the proof, so it cannot redirect funds or take more. It checks every request exactly as the contract will, plus a local proof check, before spending any gas.
4. **Private swaps.** A swap proof spends notes of one asset and creates a note of the other for exactly the quoted amount. The pool pays the seller's input only to the proof's named counterparty, and only if it delivers the bought amount in the same call. The relayer buys that amount on the exchange first, in one atomic `utility.batchAll`.

Further detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/FINANCE.md`](docs/FINANCE.md), [`docs/PRIVATE_SWAPS.md`](docs/PRIVATE_SWAPS.md).

## Why Portaldot V3

Portaldot V3 runs two virtual machines on one chain, EVM (`pallet-revive`) and WASM (`pallet-contracts`), next to native runtime pallets. Umbra's deployed flow combines EVM contracts with native pallets; a WASM verifier is tested separately:

- **EVM:** the shielded pools, Merkle trees and Groth16 verifiers, using Portaldot's BN254 precompiles.
- **Native runtime:** Portaldot `5…` accounts call the EVM contracts directly through `revive.call`; pUSD is a `pallet-assets` token reached through its ERC-20 precompile; swaps run on `pallet-asset-conversion`. A private swap batches an exchange trade, a token approval and a pool call into one atomic extrinsic.
- **WASM:** an ink! coprocessor (`umbra_coprocessor`, arkworks) verifies the *same* proofs byte-for-byte, as an independent second verifier. It is built and dry-run on testnet but not deployed (about 4,992 tPOT of storage deposit). Measured on testnet with the same proof: about 0.035 s of block weight on the EVM verifier, about 0.3 s on the WASM verifier. Details: [`docs/CROSS_VM.md`](docs/CROSS_VM.md).

## Using the app

You need a supported Portaldot Extension account or an EVM wallet connected to Portaldot V3 testnet, funded with testnet tPOT for deposits and fees. A token deposit also needs the corresponding pUSD balance.

1. **Connect.** Open the app and connect your Portaldot account.
2. **Create a private account.** Go to **Privacy → Private balance**, choose a passcode and create the account. Save the spend key it shows (`umbra-sk-…`); it is the only way to recover the balance.
3. **Deposit.** Deposit tPOT or pUSD into the private balance. Your wallet signs this public entry transaction.
4. **Pay privately.** Under **Pay → Send**, paste a private address. With the default relayed route, your wallet does not sign the spend. Self-submission is an explicit alternative that reveals your wallet as the submitter.
5. **Request money.** Under **Pay → Request**, create a link or QR code for tPOT or pUSD. Track it under **My requests**; private payments mark it paid automatically.
6. **Swap privately.** Under **Swap → Private swap**, sell tPOT for pUSD (or the reverse). You receive exactly the quoted amount as a new private note.
7. **Withdraw.** Under **Privacy → Private balance → Withdraw**, send funds to any address, ideally a fresh one.

The relayer charges a fee per private transaction, taken from the private balance (see [Costs](#costs-and-units)).

## Umbra Checkout

[Open the merchant dashboard](https://umbrav1.up.railway.app/?merchant=1), or choose **Pay → Checkout** in the app. A public wallet connection is not required to create a storefront.

### Sell a digital product

1. Enter a product name, description, pUSD price and your private receiving address.
2. Add the text to deliver after payment, or select **Use sample product** to load *Umbra Field Notes*.
3. Create the checkout and **download the merchant backup**. This restores dashboard access; back up the private account's spending key separately to recover funds.
4. Share the hosted link or QR code. The generated HTML button can be embedded in another website.
5. Refresh **Orders** to verify payments. Receive the pUSD directly in your existing private account.

### Buy and recover a purchase

Buyers can pay from a funded private pUSD balance or connect a wallet. The checkout shows the private-payment total including the relayer fee; wallet payments require tPOT for network fees. Save the order recovery link before leaving. The app polls for verification, and the download unlocks only when the server finds the exact payment note and its valid merchant-encrypted ciphertext in finalized pool events.

If a wallet or network request fails, **Check payment status** before retrying a payment. A recovery link can reopen the order and retrieve its paid download. Anyone holding that link has access to the purchase, so keep it private.

| Included today | Current boundary |
|---|---|
| Hosted storefront, QR code and HTML link button | One immutable product per checkout; create a new checkout to change its price |
| Private-balance or wallet-funded payments | Portaldot V3 testnet pUSD only |
| Verified delivery | `.txt` download, up to 6,000 characters; no arbitrary file uploads |
| Merchant order dashboard and backup restoration | Backup grants dashboard access, not spending power |
| Persistent order storage | One relayer replica with a persistent volume; not a multi-replica database |

The merchant and checkout operator can see the product, price, receiving address and order payment note. The operator hosts the download and can withhold delivery. This is **not** an escrow, refund system or privacy guarantee against the operator. No new smart contract is required: checkout uses the deployed multi-asset pool.

See [the checkout integration guide](docs/CHECKOUT.md) for API routes, verification mechanics, deployment and trust assumptions, and [the checkout review](docs/CHECKOUT_AUDIT.md) for audit scope and regression coverage.

## Deployed contracts

Every contract Umbra deploys on Portaldot V3 testnet is listed here, with its address and the transaction that created it. All ten have deployed code on chain. The source of truth is [`deployments/testnet.json`](deployments/testnet.json), which the app reads directly.

| | |
|---|---|
| App | https://umbrav1.up.railway.app |
| Relayer | https://umbra-relayer-production.up.railway.app (`/status`, `/health`) |
| Relayer account | `5HQrCKWqR2q6zfGgnbQ7VUxzqjrzDtspuuf6of5U1PRHetPU` |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Substrate RPC | `wss://test-node-v3.portaldot.dev` |
| Explorer | [node-console.portaldot.dev](https://node-console.portaldot.dev/) |
| Deployer | `5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8` (EVM `0x25a1F91BC0bBd2c87AbDF6fcDDabFACe5B69BAA7`), all contracts deployed from the Portaldot Extension via `revive.instantiateWithCode` |

| Contract | Address | Type |
|---|---|---|
| Multi-asset private pool (private balance, payments, swaps) | `0x341bE1d79E763A1Bd68f0FFccb330Ae75Da499fc` | UmbraMultiAssetPool |
| Multi-asset verifier (Groth16) | `0x6124AC4b8eCE30665f8F01831916beb427BdB16c` | MultiAssetVerifier |
| Single-asset private pool (first version, still withdrawable) | `0x499298029680abB438bBABd39461805b8EA86d45` | UmbraShieldedPool |
| Join-split verifier (Groth16) | `0x9e7e6C9c3Af320249803B5794412C6fAC78ea564` | TransactionVerifier |
| 100 tPOT pool | `0x9346d060Df4035d242c42FA5fcEC93b49F17e7Fb` | UmbraPool |
| 1,000 tPOT pool | `0x1978CdaA0CCE0219a1D63bFf8eBfa5EdE50F1442` | UmbraPool |
| 100 pUSD pool | `0x66485EC9B55B8d18f13B9Da788DAD0e5E581fC7a` | UmbraTokenPool |
| 1,000 pUSD pool | `0xfE94fa026bE1BdfeFD23c8C39DF8241704b1Db91` | UmbraTokenPool |
| Withdraw verifier (Groth16) | `0x624C510f204011F0347c2ba0939acFB629824661` | WithdrawVerifier |
| Poseidon(2) hasher | `0x5C4e3060A45F8c6985166e74c1B513A10Aa727A1` | circomlibjs Poseidon |
| pUSD (asset #7777) ERC-20 precompile | `0x00001E6100000000000000000000000000010000` | pallet-assets (not deployed by Umbra) |

Swaps use Portaldot's built-in exchange (`pallet-asset-conversion`, pool Native / asset #7777), a runtime pallet with no contract address.

**Verified live:** the first private swap was submitted by the relayer in block 215,680 as one `utility.batchAll` (exchange trade, pUSD approval, pool call), after a deposit from the user's own account in block 215,672.

Check the deployment yourself (read-only):

```bash
node scripts/verify-native-deployment.js deployments/testnet.json 5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8
cd sdk && npx --yes tsx@4.19.1 test/multiasset_live.ts
```

## Development

**Prerequisites:** Node.js 20+, [Foundry](https://book.getfoundry.sh/), and for circuit work [circom](https://docs.circom.io/) 2.1. For the WASM coprocessor: Rust 1.86 and `cargo-contract` 5.

```bash
git clone https://github.com/drained69/umbra.git
cd umbra
make install          # install every package (forge-std pinned, npm ci)
make check            # contract tests, artifact pins, SDK typecheck, frontend build
make e2e              # full system on a throwaway local chain (Anvil)
make frontend         # run the app at http://localhost:5173
```

`make check` runs entirely against local source and pinned artifacts. If Foundry fails while discovering macOS system proxy settings, run `FOUNDRY_OFFLINE=true make check`; this still executes the contract tests, artifact check, typecheck and frontend build.

**Configuration.** The app reads [`frontend/src/config/deployment.json`](frontend/src/config/deployment.json). Build-time variables:

| Variable | Purpose |
|---|---|
| `VITE_RELAYER_URL` | Relayer base URL. Without it, private sends are paused unless the user opts to sign with their own wallet. |
| `VITE_REPO_URL` | Optional source-code link in the footer. |

**Deploying contracts.** The contracts are deployed from a native Portaldot account and signed in the Portaldot Extension:

- `make estimate` prices a full deployment with live dry-runs (read-only).
- `make deploy` deploys with an EVM key (`.env`, see `.env.example`).
- `/deploy.html` on the app is an unlinked operator page that prices and deploys the multi-asset pool from the Portaldot Extension and prints the config to add to `deployments/testnet.json` and `frontend/src/config/deployment.json`.

**Docker.** `Dockerfile` builds the app (nginx, with security headers and caching). `relayer.Dockerfile` builds the relayer.

## Running the relayer

The relayer ([`relayer/`](relayer)) submits private spends without a user-wallet signature. Deposits and optional self-submitted spends still expose the wallet on chain.

| Endpoint | Purpose |
|---|---|
| `GET /status` | Relayer address, supported pools, per-asset fees |
| `GET /ma/quote?sell=&buy=&amountIn=` | Price for a private swap |
| `POST /ma/transact` | Submit a private payment or withdrawal, or execute a private swap |
| `/checkout/*` | Storefronts, merchant orders, finalized payment verification and gated downloads; [API reference](docs/CHECKOUT.md#api) |
| `POST /transact`, `POST /withdraw` | First-version private pool and fixed pools (EVM key) |

| Variable | Purpose |
|---|---|
| `RELAYER_SEED` | Secret phrase of a dedicated native account (multi-asset pool, private swaps). Required. |
| `PRIVATE_KEY` | EVM key for the first-version and fixed pools. Optional. |
| `NETWORK` | `testnet` |
| `RELAYER_FEE_SHIELDED` | Fee per private transaction in tPOT (default 9; the pUSD fee follows the exchange price) |
| `RELAYER_SWAP_SPREAD_BPS` | Spread kept on swap quotes (default 50 = 0.5%) |
| `RELAYER_CORS_ORIGIN` | The app's origin |
| `CHECKOUT_DATA_DIR` | Persistent checkout directory, e.g. `/data/checkout`; empty disables checkout |

```bash
docker build -f relayer.Dockerfile -t umbra-relayer .
docker run -e NETWORK=testnet -e RELAYER_SEED="…" -e RELAYER_CORS_ORIGIN=https://umbrav1.up.railway.app -p 8080:8080 umbra-relayer
```

**Enable checkout:** mount a persistent volume at `/data`, set `CHECKOUT_DATA_DIR=/data/checkout`, and keep the relayer at one replica. The Docker entrypoint gives the Node user access to that directory. Back up the volume; it contains orders and product content. Checkout permits 60 requests and 10 creations per minute per observed client IP, separately from transaction relaying. Reverse proxies can cause several clients to share that allowance.

**Frontend configuration:** build with `VITE_RELAYER_URL=https://umbra-relayer-production.up.railway.app` (or your own relayer URL). Vite embeds this at build time; changing only the server runtime variable does not update an already-built frontend.

Fund the relayer account with tPOT for fees and swap float, and with some pUSD to fill pUSD → tPOT swaps. Keep `RELAYER_SEED` in the host's secret settings only. Proof-bound recipient and fee terms prevent the relayer from redirecting funds or increasing its fee after a proof is made; it can still censor or delay transactions, observe network metadata, and set swap quotes. Users can self-submit supported spends at the cost of exposing their wallet as the submitter.

## Testing and verification

| Layer | Evidence | Command |
|---|---|---|
| Contracts | **75 Foundry tests** with the real Poseidon bytecode: real Groth16 proofs for the fixed pools, on-chain roots equal SDK roots, storage properties, the multi-asset pool's swap rules, audit regressions | `make test` |
| WASM coprocessor | **7 tests**: verifies the same real proofs as Solidity; rejects tampering, off-curve and non-canonical inputs | `make coprocessor-test` |
| Full system on a local chain | **30 end-to-end checks** with real proofs through the real deploy pipeline (fixed pools, join-split, private swaps in both directions, counterparty binding, tampered amounts) and **23 relayer checks** (relayed payments and withdrawals, tampering, low fees, replays, the user's wallet never signing) | `make e2e` |
| Live testnet (read-only) | **15 preflight checks**; live suites for native accounts (14), payments and requests (27), cross-VM (6), event indexing (5) and the deployed multi-asset pool (5, including a real proof accepted by the deployed verifier) | `make preflight`, `make live` |
| Real costs | Deploy cost and per-operation storage deposits from live dry-runs | `make estimate`, `make measure` |
| Proving keys ↔ verifiers | SHA-256 pinned in `sdk/artifacts/MANIFEST.json` | `node circuits/scripts/manifest.js --check` |
| SDK and app | Typecheck and production build | `make check` |
| Checkout | 15 adversarial, concurrency, outage and persistence tests; real-proof purchase, gated download and merchant spend on Anvil | `cd relayer && npm run test:checkout`, `make e2e` |

These run in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); the live suites are informative rather than blocking.

## Costs and units

- **Per private transaction:** each one stores two nullifiers, costing about **7.7 tPOT** of storage deposit on the current testnet runtime (7.99 tPOT including gas, measured). The relayer's default fee is 9 tPOT, or the pUSD equivalent.
- **Multi-asset pool deployment:** 1,021.7 tPOT of storage deposit (verifier 271.5, pool 750.3).
- **Units:** native POT has 14 decimals, but Portaldot V3's EVM layer scales balances and `msg.value` by 10⁴ to **18 decimals**. All on-chain amounts are 18-decimal EVM wei. pUSD has 6 decimals. A withdrawal to a brand-new address must be at least 0.1 tPOT (existential deposit), and an account must hold some tPOT to receive pUSD.

## Security and limitations

- **Not independently audited.** The code has had two internal review passes ([`AUDIT_REPORT.md`](AUDIT_REPORT.md)), with findings fixed and covered by regression tests. Do not use it with real funds.
- **Trusted setup.** The proving keys come from a single-contributor setup, which is suitable for a demo only. Production needs a multi-party ceremony.
- **Relayer.** It can delay or refuse service, but cannot redirect funds or raise its fee. Users can always submit transactions themselves, at the cost of revealing their account.
- **Network privacy.** The relayer and RPC providers can observe IP addresses, timing and request metadata. Umbra does not hide those network-layer signals.
- **Anonymity set.** Privacy depends on how many people use the pool. Timing, amounts and a small crowd can link activity.
- **Swap amounts** are visible on the exchange, though not linked to the trader.
- **Checkout delivery.** The operator knows order details and hosts the product. Order links are bearer capabilities. There are no automatic refunds or contract-enforced protection against paying the same order twice; verify status before retrying an ambiguous transaction.
- **Client storage.** The spend key and request history live in the browser; losing the spend key without a backup loses the balance.

Threat model and trust assumptions: [`docs/SECURITY.md`](docs/SECURITY.md).

## Roadmap

- **Batched private swaps** that hide individual amounts by netting many traders' orders ([`docs/PRIVATE_SWAPS.md`](docs/PRIVATE_SWAPS.md)).
- **Multi-party trusted setup** and an independent audit before any real-funds deployment.
- **WASM verifier deployment** on testnet ([`docs/CROSS_VM.md`](docs/CROSS_VM.md)).
- **Cross-chain transfers:** the current Sepolia → Portaldot route is a one-way, operator-trusted prototype, implemented and locally tested but not live. A reverse route and independent security review are future work ([`docs/BRIDGE_PROTOTYPE.md`](docs/BRIDGE_PROTOTYPE.md), [`docs/PRIVACY_LAYER.md`](docs/PRIVACY_LAYER.md)).
- **Mainnet:** Portaldot V3 Live runs the same EVM-capable runtime; see [`docs/MAINNET.md`](docs/MAINNET.md) for the prerequisites.

## Repository layout

```
contracts/    Solidity pools (fixed, join-split, multi-asset), Merkle trees, verifiers, tests
circuits/     circom circuits (withdraw, join-split, multi-asset), trusted setup, artifact manifest
coprocessor/  WASM verifier: no_std arkworks core (tested) and ink! contract
sdk/          TypeScript SDK: notes, keys, Merkle trees, provers, pool clients, payments,
              swaps, relayer client; artifacts/ (proving keys, pinned); test/ (e2e and live)
relayer/      Relayer service (EVM and native accounts, private swaps)
frontend/     React/Vite app, plus deploy.html (operator page)
scripts/      Preflight, deploy, cost estimates, verification, e2e runner
deployments/  Deployed addresses per network
docs/         Architecture, finance, private swaps, cross-VM, security, mainnet, demo
```

## License

MIT, except `contracts/src/verifiers/*Verifier.sol`, generated by snarkjs (GPL-3.0).
