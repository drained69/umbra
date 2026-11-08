# Umbra — Pay, Swap & Sell Privately on Portaldot

## Project Introduction

**Umbra is a zero-knowledge privacy layer for payments, merchant checkout, and asset swaps on Portaldot V3.** It combines a web application, a TypeScript SDK, and a transaction relayer around a deployed multi-asset shielded pool.

I built Umbra to address a practical concern: accepting or making a payment should not require someone to expose their wider financial activity. Creators, freelancers, merchants, and individuals need payment tools that protect sensitive information while remaining straightforward to use.

The application allows users to hold **tPOT and pUSD in a private account**, send and receive private payments, create payment requests, split bills, exchange assets, and withdraw funds. **Umbra Checkout** extends this infrastructure to digital commerce: merchants can create a hosted storefront, share a checkout link, receive pUSD into their private account, and deliver a text download after the server verifies payment.

The browser generates zero-knowledge proofs, which Portaldot verifies on chain. For supported private spends, the default relayer route submits the transaction without using the user’s public wallet as its sender. Deposits remain public, and privacy depends on the activity and anonymity available within the pool.

**Current stage:** a deployed Portaldot V3 testnet beta using test assets with no monetary value. The contracts have undergone internal review but have not been independently audited.

## Problem Solved

Public blockchains provide verifiable settlement, but ordinary transfers also reveal the sender, recipient, and amount. Reusing an address can connect a single payment to a much broader record of financial activity.

For an individual, this can expose payment patterns and visible wallet balances. For a business, it can disclose customer relationships, supplier payments, and other commercially sensitive activity.

Useful privacy infrastructure must also support the tasks surrounding a payment. Users need to request funds, identify settled requests, include payment notes, exchange assets, and receive money for products they sell.

**Umbra connects these workflows through a reusable shielded balance.** Users can transfer funds privately without withdrawing for every payment. Merchants receive payments through the same pool, and traders can exchange tPOT and pUSD through a relayer without submitting the swap from their own public wallet.

Umbra also provides viewing keys for supported shielded-pool activity. Users can disclose that history to an accountant, auditor, or another trusted party without granting permission to spend their funds.

The objective is to make private payments practical while giving users a clear account of what each action protects and what remains visible.

## Link

- **Live Web / Demo Video:** [Umbra product demonstration](https://www.youtube.com/watch?v=hMTj8YFXGWM)
- **GitHub:** [drained69/umbra](https://github.com/drained69/umbra)
- **Pitch Deck:** [View the Umbra Pitch Deck (PDF)](https://github.com/drained69/umbra/blob/7e991695acc50dc015ccedc069c75bbbc6a0adf6/submission/pitch-deck/Umbra-Pitch-Deck.pdf)
- **Network:** Portaldot V3 testnet — EVM chain ID `420420777`

The demonstration covers the core payment and swap experience. The application and merchant interface are linked in the relevant sections below.

## Technical Highlights

### 1. Multi-asset private accounts

Umbra’s multi-asset shielded pool supports both tPOT and pUSD. A private balance consists of encrypted notes, rather than a publicly readable balance attached to the user’s wallet.

Users can:

- Create a private receiving address beginning with `umbra-addr-`.
- Deposit tPOT or pUSD from a connected wallet.
- Send funds to another private account and retain change privately.
- Receive and discover encrypted payments by scanning the pool.
- Withdraw to a supported public address.
- Restore their private balance in another browser using their backed-up spend key.

The browser can store the spend key encrypted under a passcode using PBKDF2-SHA256 and AES-256-GCM. A backed-up spend key restores access to private funds. Contacts, requests, and other browser-local records require separate consideration and are not all restored by that key.

**Application:** [Open Umbra](https://umbrav1.up.railway.app/)

### 2. Private and public payment routes

Users can send tPOT or pUSD to a private address, including an optional encrypted note the recipient can read.

For a payment from an existing private balance, the default relayer route keeps the user’s public wallet out of the spend transaction. The recipient and transferred amount are hidden within the pool. The proof binds the relayer and fee, preventing the relayer from changing those terms after the proof is generated.

Umbra also supports public payments to native `5…` accounts and EVM `0x…` addresses. The interface explains the disclosure associated with each route so users can make an informed choice before submitting a payment.

### 3. Payment requests and bill splitting

Payment requests support the coordination and reconciliation needed for everyday use:

- Create a request in tPOT or pUSD and share it as a link or QR code.
- Use a private receiving address without including a public address, unless public payment is enabled.
- Include an amount and payment note in the request.
- Split a bill into individual requests whose shares add up exactly to the original total.
- Follow payment status under **My requests**.

A private payment carries its request ID inside the encrypted note, allowing the requester’s app to recognize the payment automatically.

For supported native public payments, a verifiable receipt binds the payment and request reference to the same successful transaction. The requester can therefore verify settlement on chain. Public EVM payments do not provide this native receipt mechanism.

Creating a request does not publish a transaction on chain. Anyone given the request link can, however, read the details contained in it.

### 4. Private swaps using Portaldot’s native exchange

Users can exchange **tPOT ↔ pUSD inside their private balance**, using quotes sourced from Portaldot’s built-in `pallet-asset-conversion` exchange.

The relayer acts as the swap counterparty. It executes the exchange trade, any required token approval, and the shielded-pool call inside one atomic `utility.batchAll` transaction. The pool releases the sold asset to the proof’s named counterparty only when the required bought asset is delivered.

**The swap either settles at the quoted output or the entire batch reverts.** The trader’s wallet does not sign the private swap, and the received asset becomes a new private note.

The first private swap is documented in testnet block **215,680**, following a user deposit in block **215,672**. The deployment records and verification scripts are included in the repository.

There is also a public wallet-swap interface for native Portaldot accounts, including live quotes, slippage controls, minimum received, and price-impact warnings.

The relayer’s exchange trade and its size remain visible on chain. This route protects the trader’s wallet identity in the submission, subject to timing and other correlation risks. Batching multiple traders to improve individual amount privacy remains future work.

### 5. Merchant checkout and verified digital delivery

**Umbra Checkout** applies the deployed payment infrastructure to digital-product sales without requiring a separate checkout-specific smart contract.

A creator can enter a product name, description, pUSD price, private receiving address, and text content to deliver. Umbra generates a hosted storefront, a QR code, and an HTML link button that can be embedded on another website. A public wallet connection is not required to create the storefront.

Merchants can track orders through a dashboard and download a backup that restores dashboard access. Buyers can pay from a private pUSD balance or through a connected wallet, then use an order recovery link to return to their purchase.

The download unlocks only after the server finds the matching payment in **finalized events from the configured shielded pool**. Verification checks the exact payment commitment and merchant-encrypted ciphertext. A buyer-supplied transaction hash or a client-side “paid” flag does not authorize delivery.

Verification also establishes that the merchant can decrypt the expected payment note. The server does not require the merchant’s spending key.

The interface includes *Umbra Field Notes* as a sample product, allowing reviewers to explore storefront creation without preparing their own product content.

The current version supports one immutable product per storefront and a `.txt` download of up to 6,000 characters. It uses persistent server storage for products and orders. Dashboard backups restore merchant access; the private-account spend key separately restores control of funds.

The checkout operator can see order details and controls delivery of the hosted content. Checkout is not escrow or an automatic refund system, and order recovery links must be kept private.

**Merchant interface:** [Create an Umbra storefront](https://umbrav1.up.railway.app/?merchant=1)

### 6. Shielded pools, selective disclosure, and wallet management

Alongside the multi-asset account, Umbra retains fixed-denomination pools for **100 and 1,000 tPOT**, and **100 and 1,000 pUSD**. Users can deposit a fixed amount and later prove their right to withdraw without revealing which deposit they own. The earlier single-asset shielded pool also remains supported for withdrawing existing notes.

The viewing-key interface provides read-only access to supported encrypted pool history. Users retain control over disclosure, and sharing a viewing key does not grant spending authority. This feature does not establish regulatory compliance by itself.

The wallet interface brings together public and private balances, public and private receiving QR codes, recent activity, and browser-local contacts with public addresses, private addresses, or both.

The app also includes a pool-activity privacy meter with low-cover warnings, responsive layouts, light and dark themes, and self-hosted fonts. There are no third-party analytics or font-CDN requests, although the app necessarily communicates with RPC providers and the relayer.

### 7. Browser-generated zero-knowledge proofs and developer tooling

Umbra uses Circom circuits and Groth16 proofs generated with snarkjs. The deployed EVM verifier checks those proofs using Portaldot’s BN254 precompiles.

The multi-asset circuit supports transactions with up to two input notes and two output notes. Poseidon commitments and an on-chain Merkle tree establish note membership; nullifiers prevent double spending; the circuit enforces the transaction’s asset-balance rules and binds its public terms.

Notes are encrypted using x25519 and XChaCha20-Poly1305. The contracts verify proofs without receiving the user’s private spend key or plaintext note contents.

The repository includes the TypeScript SDK, proving artifacts, pool clients, payment utilities, swap helpers, deployment tools, and relayer implementation. These components allow other Portaldot developers to inspect the design and build integrations around the same payment primitives.

### 8. Integration with Portaldot V3

Umbra’s deployed flow combines several parts of Portaldot:

| Portaldot capability | Umbra’s use |
| --- | --- |
| `pallet-revive` | EVM shielded pools, Poseidon hasher, and Groth16 verifiers |
| Native `revive.call` | Portaldot Extension accounts interact with the EVM contracts |
| `pallet-assets` ERC-20 precompile | Access to pUSD, asset #7777 |
| `pallet-asset-conversion` | Native tPOT/pUSD exchange liquidity |
| `utility.batchAll` | Atomic exchange, approval, and shielded settlement |
| Runtime dry-runs | Cost estimation and checks before signing |

Users can connect through the Portaldot Extension or a supported EVM wallet. Feature availability depends on the route: direct public swaps through the native exchange require a native Portaldot account.

Umbra also includes an **ink!/arkworks WASM verifier**, tested against the same real proof fixtures as the Solidity implementation and dry-run on testnet. It is **not deployed or used by the live app**. The deployed app uses EVM verification; the WASM work provides a separately tested verification implementation and a basis for further cross-VM development.

### 9. Validation and deployment evidence

The repository’s documented validation includes:

- **75 Foundry contract tests**, including pool behavior, storage properties, and security regressions.
- **7 WASM verification tests**, covering real proofs and malformed or tampered inputs.
- **30 local SDK end-to-end checks** using real proofs and the deployment pipeline.
- **23 relayer checks**, including tampering, fee validation, and replay rejection.
- **15 checkout tests** covering verification, persistence, outages, concurrency, and access controls.
- A local real-proof checkout purchase, gated download, merchant note discovery, and subsequent merchant spend.
- Read-only live-testnet integration suites, SDK typechecking, frontend builds, and pinned proof-artifact checks.

The repository documents these results and provides the commands needed to reproduce the checks. Internal testing and review do not replace an independent audit. Contract addresses and deployment evidence are available in the [testnet deployment record](https://github.com/drained69/umbra/blob/main/deployments/testnet.json), with further verification details in the [project documentation](https://github.com/drained69/umbra#testing-and-verification).

### 10. Privacy model, operational assumptions, and roadmap

The current implementation has the following disclosure and trust boundaries:

- **Deposits are public:** the depositor, asset, and amount are visible.
- **Relayed private payments hide their internal payment details**, but timing, network metadata, and a small user population can weaken privacy.
- **Withdrawals reveal the destination and amount**, while the proof conceals which note was spent.
- **Private swaps expose the relayer’s exchange trade and size.**
- **Self-submitting a spend reveals the submitting wallet.**
- **The relayer can delay or refuse service**, and can observe network metadata. Supported spends can be self-submitted with the corresponding privacy tradeoff.
- **Checkout discloses order information to its operator**, who also hosts the product.

Relayed transactions incur a fee deducted from the private balance. The documented multi-asset default is 9 tPOT or its pUSD equivalent, reflecting the testnet’s storage costs. Users should review the fee shown in the application before submitting.

Before any real-funds deployment, the priorities are an independent security audit and a multi-party trusted setup. The current setup is single-contributor and suitable for a demonstration.

The development roadmap includes batched private swaps, deployment of the WASM verifier, and improvements to merchant infrastructure and persistent storage. A one-way **Sepolia → Portaldot operator-trusted bridge prototype** is implemented and locally tested, but is not deployed as a live bridge. A reverse route remains future work.

The [security documentation](https://github.com/drained69/umbra/blob/main/docs/SECURITY.md) explains the threat model and remaining trust assumptions in more detail.

## Team

**Team / project:** Umbra

**Builder:** Drained99

**GitHub:** [drained69](https://github.com/drained69)

**Public contact:** [christopherakwuba4@gmail.com](mailto:christopherakwuba4@gmail.com)

My focus is to make privacy practical across the complete payment experience. That means combining sound transaction design with clear recovery steps, understandable disclosure, reliable payment recognition, and a merchant workflow that people can use without first understanding the underlying cryptography.

## Judges & Voting Fit

**For Judges**

Umbra demonstrates a deployed zero-knowledge payment system with practical user workflows and a merchant application. Its private swap flow combines an EVM shielded pool with Portaldot’s native exchange in a single atomic transaction, submitted by a relayer on the user’s behalf.

Checkout demonstrates how the same pool can support digital commerce through finalized-payment verification, merchant order tracking, and gated delivery. This extends the project beyond private transfers into a working application of the underlying infrastructure.

The submission provides a public application, source code, deployment records, real-proof test coverage, a reusable SDK, and documented trust assumptions. Its contribution to Portaldot is a usable testnet product together with payment infrastructure that other developers can inspect and extend.

**For Community Voters**

Umbra is designed for people who want more control over the information they disclose when paying or receiving money. A private receiving address, a payment request, or a hosted checkout link provides a familiar starting point for using the underlying privacy system.

Reviewers can connect a testnet wallet, create and back up a private account, deposit test funds, and send a payment to another private address. The application also supports exploring requests, bill splitting, swaps, and a sample merchant storefront. Sufficient test funds are needed for deposits, relayer fees, and network costs.

I welcome feedback on the payment experience and merchant workflow, particularly where clearer explanations or fewer steps would make the product easier to use. That feedback will help determine the next priorities for Umbra’s development.
