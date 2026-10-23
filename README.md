# Umbra — Confidential POT & Portaldot-Asset Payments on Portaldot V3

> Private, unlinkable native-token payments for Portaldot V3 — with the heavy
> zero-knowledge verification offloaded to Portaldot's **WASM** VM while assets stay in
> the **EVM** VM. One chain, two VMs, each doing the job it is best at.

**Portaldot Hacker House 2026 · Track: Ecosystem DApps (+ Modular Cloud & Middleware)**

---

## Why this can only be built well on Portaldot V3

A Groth16 proof verification is a bn254 pairing check — hundreds of thousands of gas on
an EVM-only chain. Portaldot V3 is one of the few chains that runs **two VMs on the same
chain**: EVM (`pallet-revive` / PolkaVM) *and* WASM (`pallet-contracts`). Umbra treats the
WASM VM as a **ZK coprocessor**:

- **EVM layer** (`UmbraPool.sol`) holds the shielded tPOT, the Merkle tree of note
  commitments, and the spent-nullifier set. Familiar, MetaMask-native.
- **WASM layer** (`umbra_coprocessor`, ink! + arkworks) runs the pairing check cheaply,
  with no EVM gas-loop ceiling and real Rust crypto libraries.
- The pool consumes the result through a single `IVerifier` interface, so it does not
  care which VM verified the proof — that indifference *is* the architecture.

This "right VM for the right job" split is the answer to the question every judge asks:
**why does this need Portaldot?** Most submissions are EVM-only and can't answer it.

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
- **Read-only viewing keys**: reveal your history to an auditor you choose — never spend power.
- **Built for Portaldot's storage economics**: deposits allocate no storage (was 8.96 tPOT
  locked per 1 tPOT deposit before the redesign). See
  [`docs/PORTALDOT_INTEGRATION.md`](docs/PORTALDOT_INTEGRATION.md).

## Status (what is actually proven)

Audited internally in two passes — see [`AUDIT_REPORT.md`](AUDIT_REPORT.md): 23 findings (1 Critical,
5 High), all Critical/High/Medium/Low fixed or mitigated with tests; informational items documented.

| Layer | Evidence | Command |
|---|---|---|
| Contracts (tPOT/asset/join-split pools, factory, bridge) | **47 tests** with the real Poseidon bytecode: real Groth16 proofs, on-chain roots == SDK roots, storage-slot properties, audit regressions | `make test` |
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

## Networks & mainnet

Target for the hackathon: **Portaldot V3 testnet**. Portaldot also runs **PortaldotV3 Live**
(real POT) with the same EVM-capable runtime — Umbra is technically deployable there via
native extrinsics, but confirm its status with Portaldot and complete a trusted-setup ceremony
+ independent audit first. The legacy mainnet has no EVM. Details:
[`docs/MAINNET.md`](docs/MAINNET.md).

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

- **Innovation (30%)** — WASM-as-ZK-coprocessor for an EVM asset layer is a novel,
  chain-native pattern; viewing keys turn a mixer into a compliance-capable layer.
- **Technical feasibility (30%)** — real circuit, real trusted setup, real on-chain proof
  verification on-chain *and* in WASM, 31 + 7 tests, a 25-check E2E on the real deploy
  pipeline, and live-testnet preflight.
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
