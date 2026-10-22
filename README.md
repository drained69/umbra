# Umbra — Confidential tPOT Payments on Portaldot V3

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

- **Shield**: deposit a fixed denomination (1 / 10 / 100 tPOT) behind a commitment
  `Poseidon(nullifier, secret)`. Only the commitment is on-chain.
- **Private withdraw**: prove in zero knowledge that you own *an* unspent note — never
  *which* one — and withdraw to any address. No on-chain link between deposit and
  withdrawal.
- **Gasless to fresh addresses**: a relayer pays gas and takes a small, proof-bound fee,
  so the recipient can be a brand-new wallet (true unlinkability).
- **Viewing keys & selective disclosure**: every action can carry a memo encrypted to a
  viewing key. You — or an auditor you *choose* to hand the key to — can reconstruct your
  full history, with nothing exposed publicly. **Privacy with compliance, not a black box.**

## Status (what is actually proven)

| Component | State |
|---|---|
| EVM pool state machine (Merkle, nullifiers, relayer, factory) | ✅ `forge test` — 11/11 |
| ZK circuit + trusted setup + SDK note/merkle math | ✅ real proof generated & verified (JS) |
| On-chain Groth16 verifier accepts real proof, rejects tampered | ✅ `forge test` — 2/2 |
| Frontend (deposit / withdraw / audit + visualizer) | ✅ `vite build` passes |
| Gasless relayer | ✅ implemented (local proof precheck + submit) |
| ink!/WASM coprocessor (dual-VM verify) | ✅ source + build; wired via bridge/attestor |

**13/13 contract tests pass**, including on-chain verification of a genuinely generated
Groth16 proof. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/CROSS_VM.md`](docs/CROSS_VM.md).

## Quickstart

```bash
make install          # JS deps for all packages
make test             # Foundry tests (contracts + real-proof verifier)
make zk               # trusted setup -> WithdrawVerifier.sol + proving artifacts
cp .env.example .env  # add a testnet PRIVATE_KEY (14-decimal POT!)
make deploy           # deploy Poseidon + verifier + factory + pools to Portaldot V3
make relayer          # start the gasless relayer
make frontend         # open the dApp at http://localhost:5173
```

> **POT has 14 decimals, not 18.** All amount math uses `deployment.decimals` — never
> hardcode 18 (a documented Portaldot V3 footgun).

## Repository layout

```
contracts/     Solidity: UmbraPool, Merkle tree, factory, coprocessor bridge, verifier, tests
circuits/      circom withdraw circuit + trusted-setup + example prover
coprocessor/   ink!/WASM Groth16 verifier (arkworks bn254) — the dual-VM coprocessor
sdk/           TS client: notes, Merkle paths, proofs, viewing keys (shared by app + relayer)
relayer/       gasless withdrawal relayer (+ optional cross-VM attestation)
frontend/      React/Vite dApp with the "what leaks" privacy visualizer
scripts/       testnet deploy pipeline
docs/          architecture, cross-VM, demo script, security/threat model
```

## How this maps to the judging criteria

- **Innovation (30%)** — WASM-as-ZK-coprocessor for an EVM asset layer is a novel,
  chain-native pattern; viewing keys turn a mixer into a compliance-capable layer.
- **Technical feasibility (30%)** — real circuit, real trusted setup, real on-chain proof
  verification, 13/13 tests, building blocks all exercised end-to-end.
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
