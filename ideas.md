# Portaldot Hacker House 2026 — Project Idea

Source: https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail

## Hackathon context

- Portaldot Network V3.0: Substrate-style chain with **dual execution** — WASM (ink!) + EVM (Solidity) — plus ERC-20/ERC-721 support.
- Testnet (updated endpoints):
  - EVM RPC: `https://test-evm-rpc-v3.portaldot.dev`
  - Chain ID: `420420777`
  - Native WS: `wss://test-node-v3.portaldot.dev`
  - Node console: https://node-console.portaldot.dev/
- Tracks: 1) Modular Cloud & Middleware 2) Multi-Chain & Cross-Chain Infra 3) Node Ops & Tooling 4) Ecosystem DApps
- Prize pool: 5,200 USDT (Grand Prize 1,000; Track 1st 800; Ecosystem DApps 2nd/3rd 500/300; Community Choice 200)
- Evaluation: Technical feasibility 30% · Innovation 30% · Ecosystem contribution 20% · Business potential 20%
- Key deadlines (UTC): check-in **Oct 24 12:00** · final submission / code freeze **Nov 6 04:00** · Demo Day Nov 8–9 · winners Nov 11
- Rules notes: public repo with ≥3 commits during the event, no bulk commits in the final 24h, must deploy on Portaldot testnet, demo video ≤3 min showing Portaldot integration.

## Chosen idea: Umbra — confidential tPOT payments with a WASM ZK coprocessor (Track: Ecosystem DApps + Modular Cloud & Middleware)

Private, unlinkable native-token payments on Portaldot V3. Shielded pool (Tornado/Aztec-style): deposit a fixed denomination behind a Poseidon commitment, withdraw with a zero-knowledge proof of Merkle membership that hides *which* note you spend. The headline differentiator: the expensive Groth16 pairing check runs in Portaldot's **WASM** VM (ink!/arkworks coprocessor) while assets live in the **EVM** VM — "the right VM for the right job," the answer to *why Portaldot*. Plus **viewing keys / selective disclosure**: privacy by default, auditable by choice (compliance-capable, not a black-box mixer).

**Why this idea**: (1) structurally depends on the dual-VM → airtight "why Portaldot" for Innovation; (2) privacy is a category no other submission occupies; (3) ships as a reusable privacy primitive + ZK-coprocessor SDK → Ecosystem; (4) confidential payments + selective disclosure is the live frontier (Aztec, confidential stablecoins), relayer fee = revenue → Business.

**Status**: contracts + ZK + SDK + frontend + relayer + coprocessor all built; 13/13 Foundry tests pass incl. on-chain verification of a real Groth16 proof. See README.md and docs/.

### Architecture (built — see docs/ARCHITECTURE.md + docs/CROSS_VM.md)

1. **EVM layer** — `UmbraPool.sol` (Poseidon Merkle tree + nullifier set + relayer), `UmbraPoolFactory` (1/10/100 tPOT pools), `IVerifier` (VM-agnostic).
2. **ZK** — `circuits/withdraw.circom` (Poseidon Merkle membership + nullifier, params bound anti-tamper); trusted setup exports `WithdrawVerifier.sol` + proving artifacts.
3. **WASM coprocessor** — `coprocessor/` ink! + arkworks bn254 Groth16 verifier; EVM reaches it via `UmbraCoprocessorBridge` (precompile path) or relayer attestation (testnet path). This is the dual-VM innovation proof.
4. **SDK** — `sdk/` notes, Merkle paths, snarkjs prover, viewing keys + selective disclosure (shared by app + relayer).
5. **Frontend** — deposit / private withdraw / auditor + the "what leaks" visualizer.
6. **Relayer** — gasless withdrawals to fresh addresses + optional cross-VM attestation.

### Timeline (UTC deadlines)

- **Oct 22 (today)**: full stack built + 13/13 tests green → satisfies the Oct 24 *working prototype* check-in. Next: deploy to testnet (`make deploy`), record a ≤3-min demo per docs/DEMO.md.
- **Oct 24 12:00**: check-in (working prototype) — ✅ ready.
- **Oct 27**: office-hours application deadline — apply for mentor feedback.
- **Oct 30–Nov 4**: polish; optional stretch = join-split arbitrary-value private transfer.
- **Nov 5**: demo video + pitch deck (problem · why Portaldot is essential · working proof · roadmap).
- **Nov 6 04:00**: code freeze. Commits already spread across the build (no final-24h bulk).

### Stack

- Contracts: Solidity (Foundry) + ink! (Rust/arkworks) WASM coprocessor
- ZK: circom + snarkjs (Groth16, bn254), Poseidon
- Frontend: React + Vite + ethers (MetaMask)
- Relayer/scripts: Node + ethers (+ optional @polkadot/api for cross-VM)
- Testnet: Portaldot V3 EVM RPC (chain 420420777); test POT from Discord admin DM

### Stretch / backup

- **Stretch**: join-split circuit → arbitrary-value private transfers between shielded users (Aztec-style), reusing the same engine.
- **Backup framings of the same build**: pitch primarily as Ecosystem DApps, secondarily as Modular Cloud & Middleware (privacy layer + ZK-coprocessor SDK).
