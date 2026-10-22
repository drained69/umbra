# Security Model, Trust Assumptions & Known Limitations

An internal security audit was performed on 2026-10-22 — findings and fixes are in
[`AUDIT_REPORT.md`](../AUDIT_REPORT.md). **It is not a substitute for an independent
professional audit, which is required before any real-funds deployment** (see
[`MAINNET.md`](MAINNET.md)).

## Trust assumptions

| Component | Assumption | Notes / production path |
|---|---|---|
| Trusted setup | Local single-contributor Powers-of-Tau + phase 2 | **Demo only.** A party knowing the toxic waste could forge proofs and drain pools. Replace with a multi-party ceremony (`PTAU_URL=` + multi-contributor phase 2) before real funds. `sdk/artifacts/MANIFEST.json` records which setup produced the keys. |
| Relayer | Liveness only — can censor, cannot steal | Proofs bind `recipient`, `relayer`, `fee`. Users can always self-withdraw. |
| Attestor (cross-VM Path B) | Trusted to attest only WASM-verified proofs | Fails closed; attestations are domain-separated (chain + bridge + proof). Path A (direct EVM→WASM) removes this trust. |
| Contracts | Immutable, no admin keys, no pause | No upgrade path and no one can freeze or move user funds. Bugs cannot be patched in place — migrate by deploying new pools. |
| Viewing keys | Read-only by construction | Memos contain commitment / nullifierHash / amount / time only — never spend secrets (enforced in the SDK). |

## What Umbra hides — and what it doesn't

- **Hidden**: which deposit a withdrawal spends; links between deposits, transfers and
  withdrawals; join-split amounts and owners; (with the relayer) the recipient's gas trail.
- **Not hidden**: fixed-pool amounts equal the pool denomination; join-split deposit and
  withdrawal *amounts* (`extAmount`) are public at the boundary; the `msg.sender` of a
  transaction is public (use the relayer for withdrawals).
- **Anonymity set** = other notes in the same pool. A pool with few deposits gives little
  privacy; timing and network metadata (IP, wallet RPC) can still correlate users.

## Protections covered by tests

| Property | Where tested |
|---|---|
| Double-spend prevention (both pools) | `forge test`, E2E |
| Unknown / stale root rejected; recent roots accepted | `forge test` |
| Relayer cannot raise fee / redirect funds (proof-bound) | `WithdrawVerifier.t.sol`, E2E, relayer smoke |
| Join-split value conservation + extData binding | `UmbraShieldedPool.t.sol`, `TransactionVerifier.t.sol`, E2E |
| No payout to `address(0)`; non-payable withdraw | `AuditRegressions.t.sol` |
| Attestations non-replayable across bridges/inputs | `AuditRegressions.t.sol` |
| Coprocessor: canonical fields, on-curve, subgroup, input count | `cargo test -p umbra_groth16` |
| Viewing keys reveal history but no spend secrets | E2E |
| Proving keys match committed verifiers | `manifest.js --check` (CI) |

## Known limitations

- **Trusted setup is demo-grade** (above). This is the single most important blocker for
  real value.
- **No independent audit yet.**
- **Commitment / nullifierHash share Poseidon(2) domain** in the fixed-denomination circuit
  (`commitment = H(n, s)`, `nullifierHash = H(n, 0)`). Harmless with random secrets
  (collision needs `s = 0`), but a future circuit version should domain-separate; changing
  it requires a new setup.
- **Existential deposit**: withdrawals of < 0.1 tPOT to an account that doesn't exist yet
  are rejected by the chain; the SDK checks this up front.
- **Relayer is a single operator** in this release (no fee market / decentralized network).
- **Browser proving** loads ~7 MB (fixed pool) or ~14 MB (join-split) of artifacts.
- `evm_version = paris` is conservative; `make preflight` verifies the opcodes and
  precompiles the contracts rely on are present on the target network.

## Reporting a vulnerability

Please do not open public issues for security bugs. Contact the maintainers privately
(see repository owner) with a description and reproduction; we aim to respond within 72h.
