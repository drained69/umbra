# Security, Trust Assumptions & Known Limitations

Honest accounting for judges. This is a hackathon build — **not audited, no real funds**.

## Trust assumptions

| Component | Assumption | Mitigation / production path |
|---|---|---|
| Trusted setup | Local single-contributor Powers-of-Tau + phase-2 | Replace with a multi-party ceremony before any real use. Soundness of the circuit is independent of the ceremony; the ceremony protects against a prover forging proofs. |
| Relayer (`VERIFIER_MODE=onchain`) | Liveness only — can censor, cannot steal | Proof binds `recipient/relayer/fee`; users can always self-withdraw (pay their own gas). |
| Attestor (Path B cross-VM) | Trusted to mirror the WASM result honestly | Replace with Path A direct EVM→WASM call (no attestor) once the runtime exposes the precompile/chain-extension. |
| Poseidon / verifier deployment | Deployed bytecode matches the circuit's hash/VK | Deterministic: Poseidon from circomlibjs, verifier from snarkjs; both pinned to the trusted-setup output. |

## Privacy caveats (what Umbra does and does NOT hide)

- **Hidden**: which deposited note a withdrawal spends; the deposit↔withdrawal link;
  (for fresh recipients via relayer) the funding trail.
- **Not hidden by the pool alone**: the *amount class* is the pool's fixed denomination.
  Use standard denominations and multiple notes to avoid amount fingerprinting.
- **Anonymity set = other deposits in the same denomination pool.** A pool with one
  deposit gives no privacy. Encourage standard denominations; the factory exists for this.
- **Timing / network metadata** can still correlate actions. Relayer + delay help; a full
  solution is out of scope for the hackathon.

## Contract-level protections (tested)

- Double-spend prevented via `nullifierHashUsed` (test: `test_WithdrawRejectsDoubleSpend`).
- Stale-but-recent roots accepted via rolling history; unknown roots rejected
  (`test_RootHistoryToleratesInterleavedDeposits`, `test_WithdrawRejectsUnknownRoot`).
- Relayer cannot over-charge: `fee > denomination` reverts; fee/recipient/relayer are
  bound into the proof (`test_WithdrawRejectsFeeTooHigh`, tamper test in verifier suite).
- Reentrancy guard on deposit/withdraw; checks-effects-interactions (nullifier set before
  payout).
- Field-range checks on leaves (`LeafOutOfField`).

## Known limitations / TODO before production

- Fixed-denomination only in the shipped pool; join-split (arbitrary value) is designed in
  `docs/ARCHITECTURE.md` but not yet wired.
- No fee market / relayer decentralization.
- `evm_version = paris` chosen for PolkaVM opcode compatibility; re-verify against the V3
  toolchain's supported opcode set at deploy time.
- Viewing-key memos are posted per action; a malicious depositor could post junk memos
  (harmless — they simply won't decrypt under any honest key).
