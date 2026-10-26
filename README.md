# Umbra — Confidential POT & Portaldot-Asset Payments on Portaldot V3

> Private payments, requests and swaps for Portaldot V3. Assets and zero-knowledge pools live
> in the **EVM**; the same Groth16 proofs can also be verified in Portaldot's **WASM** VM; and
> Portaldot's native pallets (accounts, assets, DEX) are composed with both in single
> transactions. One chain, two VMs, plus the runtime itself.

**Portaldot Hacker House 2026 · Track: Ecosystem DApps (+ Modular Cloud & Middleware)**

---

## Why this can only be built well on Portaldot V3

Portaldot V3 runs **two VMs on one chain** — EVM (`pallet-revive`) *and* WASM
(`pallet-contracts`) — next to native runtime pallets. Umbra uses all three:

- **EVM layer** (`UmbraPool.sol`, `UmbraShieldedPool.sol`) holds shielded tPOT and pUSD, the
  Merkle trees of note commitments and the spent-nullifier sets, and verifies Groth16 proofs
  with Portaldot's BN254 precompiles.
- **WASM layer** (`umbra_coprocessor`, ink! + arkworks) verifies the *same* proofs,
  byte-for-byte, as a second, independent verifier in Rust. Pools consume verification
  through one `IVerifier` interface, so a pool can be wired to either VM.
- **Native runtime**: a Portaldot `5…` account drives the EVM contracts directly through
  `revive.call`; pUSD is a `pallet-assets` token reached through its ERC-20 precompile; and
  swaps run on `pallet-asset-conversion`. A swap *from your private balance* is one
  `utility.batchAll` that withdraws from the EVM pool and trades on the native DEX — atomic,
  under one signature.

**Measured, not assumed** (live testnet dry-runs, same real proof): the EVM verifier uses
about 0.035 s of block weight, the WASM verifier about 0.3 s. BN254 has a native EVM
precompile on Portaldot, so pools verify on the EVM by default. The WASM verifier earns its
place by independence and flexibility: it needs no precompile, so it is the path for proof
systems and curves the EVM cannot verify natively, and its verifying key can be rotated after
a ceremony. The WASM path is built and dry-run on testnet; deploying it needs about
4,992 tPOT of storage deposit. Details: [`docs/CROSS_VM.md`](docs/CROSS_VM.md).

That composition — EVM contracts, a WASM verifier and native pallets in one app — is the
answer to **why does this need Portaldot?**

## What it does

- **Shield** native POT *and any Portaldot asset* — **pUSD** (asset #7777) by default, via the
  runtime's pallet-assets ERC-20 precompile → confidential stablecoin payments.
- **Private withdraw** with a zero-knowledge proof that you own *an* unspent note — never
  which one — to a `0x` address **or a Portaldot `5…` account**.
- **Use your Portaldot Extension directly**: your native account calls Umbra's EVM contracts
  through pallet-revive (`revive.call`), with account mapping batched into the same signature.
  No MetaMask, no `0x` key. EVM wallets work too.
- **Gasless to fresh addresses** via a relayer whose fee is bound into the proof.
- **Join-split pool** for arbitrary-value private transfers between shielded users.
- **Private account UI**: create or restore a shielded address, deposit arbitrary tPOT amounts,
  send encrypted notes to another user, and withdraw from the same account. The signing
  wallet remains public when it pays gas; the receiver and internal amount are hidden.
- **Everyday finance**: pay friends privately or publicly, request money with a link or QR code,
  split a bill, keep contacts, and swap tPOT ↔ pUSD on Portaldot's built-in DEX — including
  atomic swaps from or into your private balance. Private payments carry an encrypted note that
  settles the matching request automatically. See [`docs/FINANCE.md`](docs/FINANCE.md).
- **Read-only viewing keys**: reveal your history to an auditor you choose — never spend power.
- **Built for Portaldot's storage economics**: deposits allocate no storage (was 8.96 tPOT
  locked per 1 tPOT deposit before the redesign). See
  [`docs/PORTALDOT_INTEGRATION.md`](docs/PORTALDOT_INTEGRATION.md).

## Status (what is actually proven)

Audited internally in two passes — see [`AUDIT_REPORT.md`](AUDIT_REPORT.md): 23 findings (1 Critical,
5 High), all Critical/High/Medium/Low fixed or mitigated with tests; informational items documented.

| Layer | Evidence | Command |
|---|---|---|
| Contracts (tPOT/asset/join-split pools, factory, bridge, atomic swap) | **64 tests** with the real Poseidon bytecode: real Groth16 proof checks for existing pools, on-chain roots == SDK roots, storage-slot properties, audit regressions, and mock-verifier coordination tests for the new bridge and swap | `make test` |
| WASM coprocessor core | **7 tests**: verifies the *same* real proofs as Solidity; rejects tampering, off-curve, non-canonical | `make coprocessor-test` |
| Full system on a real EVM | **30 E2E checks**: real deploy pipeline → tPOT + pUSD ZK withdrawals, join-split flow, viewing keys, relayer | `make e2e` |
| Live Portaldot V3 testnet | **15 preflight + 14 native-integration checks** (read-only): precompiles, revive constants, asset precompiles, `5…` accounts calling contracts | `make preflight`, `make live` |
| Real costs on Portaldot | exact deploy cost + per-operation storage deposits via live dry-runs | `make estimate`, `make measure` |
| ZK artifacts ↔ verifiers consistency | SHA-256 pinned | `node circuits/scripts/manifest.js --check` |
| SDK + frontend | typecheck + production build | `make check` |

All of the above run in CI (`.github/workflows/ci.yml`). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CROSS_VM.md`](docs/CROSS_VM.md),
[`docs/SECURITY.md`](docs/SECURITY.md).

## Two shielded pools, one engine

- **`UmbraPool`** — fixed-denomination (1/10/100 tPOT), simplest UX, biggest anonymity set
  per denomination. The headline demo.
- **`UmbraShieldedPool`** — **join-split (UTXO)**: one `transact` can deposit, withdraw, and
  privately transfer arbitrary amounts between shielded owners at once. This is the shared
  engine the DEX / voting / payroll variants build on (see Roadmap).

## Deployed contracts — Portaldot V3 testnet

The app does not show contract addresses; they are listed here. Source of truth:
[`deployments/testnet.json`](deployments/testnet.json).

| | |
|---|---|
| Network | Portaldot V3 testnet (EVM chain ID `420420777`) |
| EVM RPC | `https://test-evm-rpc-v3.portaldot.dev` |
| Substrate RPC | `wss://test-node-v3.portaldot.dev` |
| Explorer | [node-console.portaldot.dev](https://node-console.portaldot.dev/) |
| Deployed | block 169,320, from native account `5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8` (EVM `0x25a1F91BC0bBd2c87AbDF6fcDDabFACe5B69BAA7`), via native (Portaldot Extension, revive.instantiateWithCode) |

| Contract | Address | Type |
|---|---|---|
| Join-split pool (private accounts, payments, swaps) | `0x499298029680abB438bBABd39461805b8EA86d45` | UmbraShieldedPool |
| 100 tPOT pool | `0x9346d060Df4035d242c42FA5fcEC93b49F17e7Fb` | UmbraPool |
| 1,000 tPOT pool | `0x1978CdaA0CCE0219a1D63bFf8eBfa5EdE50F1442` | UmbraPool |
| 100 pUSD pool | `0x66485EC9B55B8d18f13B9Da788DAD0e5E581fC7a` | UmbraTokenPool |
| 1,000 pUSD pool | `0xfE94fa026bE1BdfeFD23c8C39DF8241704b1Db91` | UmbraTokenPool |
| Withdraw verifier (Groth16) | `0x624C510f204011F0347c2ba0939acFB629824661` | WithdrawVerifier |
| Join-split verifier (Groth16) | `0x9e7e6C9c3Af320249803B5794412C6fAC78ea564` | TransactionVerifier |
| Poseidon(2) hasher | `0x5C4e3060A45F8c6985166e74c1B513A10Aa727A1` | circomlibjs Poseidon |
| pUSD (asset #7777) ERC-20 precompile | `0x00001E6100000000000000000000000000010000` | pallet-assets, not deployed by Umbra |

Swaps use Portaldot's native DEX (`pallet-asset-conversion`, pool Native / asset #7777), a
runtime pallet with no contract address. The WASM verifier (ink! coprocessor), its bridge
and the WASM-verified pool are not deployed yet; see [`docs/CROSS_VM.md`](docs/CROSS_VM.md).

Verify every address above against the chain (read-only):

```bash
node scripts/verify-native-deployment.js deployments/testnet.json 5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8
```

Deployment tools for operators are not linked in the app. They live at `/?admin` (WASM
verifier) and `/?admin=full` (full contract set), and every step is signed in the Portaldot
Extension.

## Networks & mainnet

Target for the hackathon: **Portaldot V3 testnet**. Portaldot also runs **PortaldotV3 Live**
(real POT) with the same EVM-capable runtime — Umbra is technically deployable there via
native extrinsics, but confirm its status with Portaldot and complete a trusted-setup ceremony
+ independent audit first. The legacy mainnet has no EVM. Details:
[`docs/MAINNET.md`](docs/MAINNET.md).

## Privacy-layer roadmap

Umbra's next product is a Portaldot privacy hub for payments, private batch swaps, and
Ethereum Sepolia ↔ Portaldot testnet transfers. The first proposed DEX pair is tPOT ↔ pUSDT;
pUSD is a later target because the observed pUSD pair has no liquidity. Neither swap nor bridge
feature is live yet. The architecture, privacy boundaries, evidence gates, and demo order
are in [`docs/PRIVACY_LAYER.md`](docs/PRIVACY_LAYER.md). Run
`node scripts/privacy-route-readiness.js` for read-only route evidence.
An operator-trusted testnet lockbox, destination adapter, and dry-run relay command are
implemented and locally tested. They require a funded operator and verified token mapping;
they are not a trust-minimized bridge or a live route yet. The current prototype supports
Sepolia → Portaldot only; see [`docs/BRIDGE_PROTOTYPE.md`](docs/BRIDGE_PROTOTYPE.md).
An atomic fixed-denomination tPOT/ERC-20 note exchange is also implemented and locally
tested. A pUSDT pool, real order-bound proof flow, and safe private submission are still
needed before it can be offered to users. See [`docs/PRIVATE_SWAPS.md`](docs/PRIVATE_SWAPS.md).

## Quickstart

```bash
make install          # deps for every package (forge-std pinned, npm ci)
make check            # contract tests + artifact pins + SDK typecheck + frontend build
make e2e              # full system on a throwaway local chain
cp .env.example .env  # add a testnet PRIVATE_KEY
node scripts/evm-funding-address.js   # where to send your faucet tPOT (5... -> your 0x key)
make estimate         # exact cost on the live chain (read-only) — fund the deployer accordingly
make deploy           # runs `make preflight`, then deploys everything to Portaldot V3
make relayer          # start the gasless relayer
make frontend         # open the dApp at http://localhost:5173
```

> **Units:** native POT has 14 decimals, but Portaldot V3's EVM layer exposes balances and
> `msg.value` scaled ×10⁴ to **18 decimals** (verified against the live chain — run
> `make preflight`). All on-chain amounts are 18-dec EVM wei; withdrawals to brand-new
> addresses must be ≥ 0.1 tPOT (existential deposit).

## Repository layout

```
contracts/     Solidity: both pools, Merkle trees, factory, coprocessor bridge, verifiers, tests
circuits/      circom circuits (withdraw, join-split) + trusted setup + fixture provers + manifest
coprocessor/   groth16/ (no_std arkworks core, tested) + contract/ (ink! WASM coprocessor)
sdk/           TS SDK: notes, UTXOs, keypairs, Merkle, provers, viewing keys, pool clients
               artifacts/ = proving keys + wasm + vkeys (pinned by MANIFEST.json); test/ = E2E
relayer/       hardened gasless withdrawal relayer (+ fail-closed cross-VM attestation)
frontend/      React/Vite dApp with the "what leaks" privacy visualizer
scripts/       preflight, multi-network deploy, vk_to_words, e2e runner
docs/          architecture, cross-VM, security, mainnet, demo script, schedule
```

## How this maps to the judging criteria

- **Innovation (30%)** — one app composes EVM contracts, a WASM verifier and native
  pallets: private payments with encrypted notes that settle payment requests, and swaps
  that draw from or deliver into a private balance atomically on Portaldot's native DEX.
  Viewing keys turn a mixer into a compliance-capable layer.
- **Technical feasibility (30%)** — real circuits and Groth16 proofs verified on-chain; the
  same proofs verified by the WASM verifier (tested natively and dry-run on testnet);
  64 contract + 7 WASM tests, a 30-check E2E on the real deploy pipeline, live-testnet
  preflight, and read-only live SDK tests for payments, swaps and the cross-VM path.
- **Ecosystem contribution (20%)** — ships a reusable privacy primitive **and** a drop-in
  ZK-coprocessor pattern + SDK other Portaldot dApps can adopt (private DEX, DAO voting,
  payroll — see `docs/ARCHITECTURE.md` §Roadmap).
- **Business potential (20%)** — confidential payments with selective disclosure is the
  live frontier (Aztec, confidential stablecoins); relayer fees are a built-in revenue model.

## Security & honesty

This is a hackathon build. The local trusted setup is for demo reproducibility — a
production deployment needs a real multi-party ceremony. See
[`docs/SECURITY.md`](docs/SECURITY.md) for the threat model, trust assumptions (relayer,
attestor, setup), and known limitations. Nothing here is audited; do not use with real funds.

## License

MIT (except `contracts/src/verifiers/WithdrawVerifier.sol`, generated by snarkjs: GPL-3.0).
