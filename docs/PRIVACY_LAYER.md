# Umbra: the privacy layer for Portaldot

Status: product architecture and testnet delivery plan, 2026-10-25. The existing payment pools are deployed; cross-chain transfers and private swaps are **not** live features.

## Product promise

Umbra gives Portaldot users one private account for **paying, swapping, and moving value across chains**. Users can reveal selected activity with a read-only viewing key. Portaldot is the privacy hub: public assets enter a shared shielded vault, move as encrypted notes, and leave through verified route adapters.

The first proposed cross-chain route is **Ethereum Sepolia ↔ Portaldot V3 testnet**. The first DEX-backed swap route is **tPOT ↔ pUSDT**, because the observed WPOT/pUSDT pair has reserves while the observed WPOT/pUSD #7777 pair does not. The pUSD route remains a later target. pUSD #7777 and pUSDT are distinct assets and must never be labeled interchangeably. Neither route is live in Umbra yet.

## What exists now

| Component | State |
| --- | --- |
| Fixed-size tPOT and pUSD shield/withdraw, viewing keys | Deployed on V3 testnet |
| Arbitrary-value tPOT join-split, encrypted private transfers | Deployed; SDK and app flow |
| Gasless fixed-pool withdrawal relayer | Implemented; deployment URL required |
| WASM Groth16 verifier core | Tested; current deployed pools use EVM verification |
| Multiasset join-split vault | Needed |
| Fixed-denomination tPOT ↔ ERC-20 note exchange | Atomic two-proof contract and tests implemented locally; no pUSDT pool or live UI |
| Variable-amount DEX-backed private swap | Needed |
| Operator-trusted Sepolia lockbox and Portaldot inbox | Implemented and tested locally; one-shot relay command checks both sides before sending |
| Trust-minimized Sepolia ↔ Portaldot finalized-message verifier | Needed; no verified testnet bridge address established |

## Architecture

```text
Ethereum Sepolia                  Portaldot V3 privacy hub
public test asset ── bridge ──> verified inbox ──> multiasset shielded vault
                                               ├─ private payments
                                               ├─ private batch swap settlement
                                               └─ verified outbox ── bridge ──> Sepolia
                  encrypted intents ──> coordinator/relayer
                  read-only viewing key ──> user-selected auditor
```

**Multiasset vault.** Extend the current join-split note to commit to `domain, assetId, amount, ownerPublicKey, blinding`. The proof must bind inputs and outputs to asset IDs, enforce per-asset balance conservation, prevent nullifier reuse, and bind fees, recipient, route, deadline, and minimum output. Asset deposits and withdrawals must check token balance deltas. Keep existing pools as a working migration path; the new vault is a new contract and circuit, not an upgrade of the current native-only pool.

**Cross-chain inbox.** A bridge adapter accepts a finalized source-chain message and credits a commitment to the recipient's Portaldot shielded account. The authenticated payload must bind source and destination chain IDs, source contract, nonce, token mapping, amount, commitment, and version. The replay key is the source nonce within a fixed source domain, so changing the commitment cannot reuse a message. Verify that the mapped asset is backed by locked source collateral or a documented issuer arrangement. The bridge's validator set, finality rule, pause/recovery controls, and token mapping are part of the trust model.

The current [`UmbraBridgeInbox.sol`](../contracts/src/UmbraBridgeInbox.sol) is only the destination adapter for a fixed-denomination token pool. It enforces an authenticated messenger address, source chain/contract, one-use source nonce, exact token collateral, and a matching pool asset. **It trusts the configured messenger for source finality and message contents.** The adapter is useful for a local or testnet bridge integration; it is not a verified Sepolia bridge by itself.

For the hackathon prototype, [`UmbraOperatorLockbox.sol`](../contracts/src/UmbraOperatorLockbox.sol) locks one source denomination and emits the destination note commitment. [`bridge-relay.js`](../scripts/bridge-relay.js) checks both chain IDs, contract wiring, the token mapping, source event, pending state, and a configurable confirmation count. It defaults to a read-only check; `--send` requires an operator key, destination collateral, and gas on both chains. The operator credits the Portaldot note, waits for destination confirmations, verifies the credit event, and then settles source collateral. A delayed refund requires the same operator's non-delivery signature. The operator can still mis-credit, censor, or settle early; this is an **explicitly trusted testnet prototype**, not a production bridge. The two assets on either chain are not automatically the same asset or equal in value just because their raw units match. The [deployment runbook](BRIDGE_PROTOTYPE.md) gives the one-time route wiring and exact command.

**Cross-chain outbox.** A proof spends a shielded note and authorizes a destination-chain claim with a minimum received amount and expiry. The adapter locks/burns the Portaldot representation only after the proof succeeds. The destination claim must authenticate a finalized Portaldot message and be replay-safe. Provide a timeout/refund path that cannot race with a completed claim. The bridge boundary reveals asset and aggregate transfer amount; batching, relayers, and a populated anonymity set are required before claiming unlinkability of source and destination users.

**Private swap, first milestone: fixed-size peer-to-peer.** [`UmbraAtomicSwap.sol`](../contracts/src/UmbraAtomicSwap.sol) uses the existing native and ERC-20 fixed pools. Each user supplies a withdrawal proof, an output note commitment for the asset they receive, an encrypted memo, and an ephemeral signature over one order. Both proofs bind their zero-fee relayer field to the same order digest, including both roots, nullifiers, output commitments, memos, signers, swap ID, and deadline. The contract withdraws both notes and redeposits the exact denominations atomically; failure in either leg reverts both. No spend key is shared. The asset pair, denominations, and gas payer are public. This contract is locally tested only. It needs a pUSDT pool and funded notes for the chosen pair, real Groth16 proofs, a private submission path, and security review before enabling the UI. A copied proof can be submitted straight to a pool with the swap contract as recipient, stranding its funds; the contract cannot prevent that because the existing pool has an open withdrawal entrypoint.

**Private swap, second milestone: batch DEX execution.** Users submit encrypted intents specifying input asset, maximum spend, minimum receive, expiry, nonce, and a return shielded address. A coordinator collects a batch. A settlement proof checks authorization, note ownership, per-asset accounting, quote floors, expiry, and outputs. Matching orders can net internally; only the residual touches a verified DEX, so the public chain sees aggregate execution. A one-user batch provides little amount privacy. Users must be able to cancel or exit independently if the coordinator stalls.

## Demo-sized vertical slice

1. **First, complete payments.** Use the existing deployed pools and private-account UI for a working Alice → Bob demo with transaction evidence. Keep the relayer running for fresh recipients.
2. **Then, prove a peer-to-peer swap on Portaldot.** Deploy a pUSDT fixed pool with the verified token address, fund two independently owned notes, generate order-bound proofs, and submit the already tested atomic swap in one private transaction. This needs pUSDT balances but no DEX liquidity. Add pUSD only if actual pUSD balances become available; never relabel pUSDT as pUSD.
3. **Then, add batch DEX execution.** Verify the observed WPOT/pUSDT pair, router or pair code, liquidity, fee model, and executable quote. Settle two or more encrypted intents with one aggregate DEX trade. A direct wallet-to-router call is a public swap, not the private-swap milestone.
4. **Then, prove one inbound cross-chain transfer.** Use a verified Sepolia test asset and bridge adapter. Show a finalized Sepolia deposit credited as a Portaldot shielded note, then a private payment inside Portaldot. Add outbound redemption only after replay, finality, token backing, and refund cases pass.
5. **Expose one developer API.** `shield`, `send`, `swap`, `bridgeIn`, `bridgeOut`, `scan`, and `disclose` should share the same note/account model. Third-party Portaldot apps can integrate the privacy layer instead of copying the UI.

## Launch gates and evidence

Run `node scripts/privacy-route-readiness.js` for a read-only snapshot. Supply `SEPOLIA_RPC`, `SEPOLIA_BRIDGE`, and `PORTALDOT_BRIDGE` only after addresses are verified; the script intentionally never calls either route ready from address existence or reserves alone.

On 2026-10-25, a read-only Portaldot V3 testnet check reached chain `420420777` and the observed factory returned **no WPOT/pUSD #7777 pair**. Prior read-only inspection found a WPOT/pUSDT pair with nonzero reserves, but its factory/pair provenance and executable swap behavior are not yet verified. No official bridge adapter addresses or Sepolia RPC were configured. These are discovery results, not proof that an official iSwap or iBridge route cannot exist elsewhere.

| Gate | Required evidence |
| --- | --- |
| Sepolia ↔ Portaldot bridge | Official or independently reviewed contracts, source code, message proof/finality, token backing, both-direction testnet transactions |
| tPOT ↔ pUSDT swap | Correct pUSDT token, verified factory/router/pair code, nonzero usable reserves, quote and min-received simulation, successful test trade |
| Privacy | Two or more independent users in a batch, encrypted per-user outputs, relayed settlement, clear boundary disclosure |
| Safety | Conservation, double-spend, replay, expiry, cancellation, slippage, refund-race, and failed-route tests; independent audit before real value |
| Demo | Live URL, contract addresses, transaction links on both chains, short video and reproducible script |

## Privacy statement for the app

“Umbra hides internal transfers and individual batch-swap details. Deposits, withdrawals, bridge movements, aggregate swap execution, and gas payers may be visible. Your privacy improves when more independent users share the pool and when relayers submit transactions.”

Current setup artifacts are local single-contributor demo keys. Do not deploy a value-bearing multiasset vault with these keys. See [SECURITY.md](SECURITY.md) and [PRIVATE_SWAPS.md](PRIVATE_SWAPS.md).
