# Security Audit Report — Umbra (Confidential tPOT on Portaldot V3)

**Date**: 2026-10-22
**Auditor**: Plamen (automated + manual review)
**Scope**: entire repository — `contracts/` (UmbraPool, UmbraShieldedPool, Merkle trees,
factory, UmbraCoprocessorBridge, generated verifiers), `circuits/` (withdraw, transaction),
`coprocessor/` (ink!/WASM verifier), `sdk/`, `relayer/`, `frontend/`, `scripts/`
**Language/Version**: Solidity 0.8.24 (evm `paris`), circom 2.2.3 / Groth16 (BN254),
Rust (ink! 5, arkworks 0.4), TypeScript / Node
**Build Status**: compiled successfully; all suites green after remediation
**Live-chain verification**: Portaldot V3 testnet probed read-only (chain id, BN254
precompiles, raw-bytecode execution, value units)

> Internal review. It is **not** a substitute for an independent professional audit, and the
> demo trusted setup must be replaced by a ceremony before any real-funds deployment.

---

## Executive Summary

Umbra is a shielded-payments protocol for Portaldot V3: a fixed-denomination pool and a
join-split (UTXO) pool hide the link between deposits, transfers and withdrawals with
Groth16 proofs, a relayer enables gasless withdrawals to fresh addresses, read-only viewing
keys enable selective disclosure, and an ink!/WASM coprocessor can perform proof
verification in Portaldot's second VM.

The review found **1 Critical, 4 High, 4 Medium, 4 Low and 4 Informational** issues. The
most serious: the selective-disclosure feature placed note spend secrets inside viewing-key
memos, so anyone a user disclosed to could withdraw their funds (C-01). Several issues would
have prevented the product from working at all on the real network: on-chain value units
were mis-modeled (pools 10,000× smaller than labeled, H-01), proving keys were not versioned
with their verifiers (deposits unwithdrawable from any repo-built deployment, H-03), every
join-split transaction would revert due to an ABI-encoding mismatch (H-04), the WASM
coprocessor could not verify any real proof and trusted caller-supplied hashes (H-02), and
the deploy pipeline crashed before deploying (M-04).

**All Critical, High, Medium and Low findings are fixed**, each with a regression test or an
end-to-end check. Two informational items are acknowledged (circuit domain separation and the
demo trusted setup, the latter a hard blocker for real funds).

## Summary

| Severity | Count | Fixed | Acknowledged |
|---|---|---|---|
| Critical | 1 | 1 | 0 |
| High | 4 | 4 | 0 |
| Medium | 4 | 4 | 0 |
| Low | 4 | 4 | 0 |
| Informational | 4 | 2 | 2 |

### Components Audited

| Component | Path | Description |
|---|---|---|
| Fixed-denomination pool | `contracts/src/UmbraPool.sol`, `MerkleTreeWithHistory.sol`, `UmbraPoolFactory.sol` | Deposit / ZK withdraw, nullifiers, relayer fee |
| Join-split pool | `contracts/src/UmbraShieldedPool.sol`, `MerkleTreeWithHistoryPair.sol` | 2-in/2-out shielded transactions |
| Cross-VM bridge | `contracts/src/UmbraCoprocessorBridge.sol` | IVerifier backed by WASM verification |
| Circuits | `circuits/withdraw.circom`, `transaction.circom`, `keypair.circom`, `merkleProof.circom` | Groth16 statements |
| WASM coprocessor | `coprocessor/groth16`, `coprocessor/contract` | arkworks verifier + ink! contract |
| SDK | `sdk/src/*` | Notes, UTXOs, Merkle, provers, viewing keys, clients |
| Relayer | `relayer/*` | Gasless withdrawals, cross-VM attestation |
| Frontend / ops | `frontend/`, `scripts/` | dApp, deploy, preflight |

---

## Critical Findings

### [C-01] Viewing-key memos contained note spend secrets — disclosure enabled theft [FIXED]

**Severity**: Critical
**Location**: `frontend/src/components/DepositPanel.tsx` (memo construction), `sdk/src/viewingKey.ts` (`Memo` type)
**Confidence**: HIGH (verified by inspection; regression covered in E2E)

**Description**:
Each deposit posted an encrypted memo so the user — or an auditor they hand their viewing
key to — could reconstruct their history. The memo plaintext included the note's
`nullifier` and `secret`:

```ts
memo = encryptMemo(viewingKey, {
  action: "deposit", denomination: denomWei.toString(),
  nullifier: note.nullifier.toString(16),   // spend secret
  secret: note.secret.toString(16),         // spend secret
  ts: Date.now(),
});
```

`(nullifier, secret)` is exactly the witness needed to generate a withdrawal proof.

**Impact**:
- Any auditor/regulator the user discloses to (the advertised use case) can withdraw all of
  the user's shielded funds to an address of their choosing.
- Anyone who obtains the viewing key (leak, phishing of the signature) can do the same.
- Selective disclosure — a headline feature — was equivalent to handing over the funds.

**PoC Result**: Not required — the memo plaintext is the withdrawal witness by construction.
Post-fix, the E2E asserts disclosed memos contain no `secret`/`nullifier` and that the SDK
refuses to encrypt them.

**Recommendation / Fix**:
Memos now carry only `commitment`, `nullifierHash` (public at spend time — lets an auditor
link a deposit to its withdrawal), amount and timestamp. `encryptMemo` rejects any memo with
`nullifier`, `secret`, `privateKey`, `blinding` or `spendKey` fields (defense in depth). The
auditor view shows "shielded / withdrawn" via a read-only `isSpent(nullifierHash)` lookup.

---

## High Findings

### [H-01] On-chain value units mis-modeled — pools 10,000× smaller than labeled [FIXED]

**Severity**: High
**Location**: `scripts/deploy.js` (`parseUnits(d, 14)`), `frontend/src/lib/chain.ts`, `frontend/src/components/AuditorPanel.tsx`, `.env.example`, `README.md`
**Confidence**: HIGH (measured on the live testnet)

**Description**:
The build assumed EVM amounts use POT's native 14 decimals. Portaldot V3's EVM layer
(pallet-revive) actually exposes balances and `msg.value` scaled ×10⁴ to 18 decimals.
Measured on testnet: Substrate `tokenDecimals = 14`; the same account's EVM balance /
native free balance ≈ 9 999 (the residue is the 0.1 tPOT existential deposit plus
sub-native "dust").

**Impact**:
- A pool deployed as "1 tPOT" would have had a denomination of 0.0001 tPOT (and "100 tPOT"
  0.01 tPOT); every displayed amount would be 10,000× too large.
- Users would believe they shielded far more value than they did; operators would size fees
  and anonymity sets wrongly.

**PoC Result**: Live-chain measurement (`make preflight` now reproduces it:
`EVM/native value ratio ≈ 9998.9 (expected 10000)`).

**Recommendation / Fix**:
Explicit unit model: `networks.json` records `evmDecimals: 18` and `nativeDecimals: 14`;
deploy and frontend format on-chain values with 18; `sdk/src/units.ts` documents the ratio
and the existential deposit; docs corrected; `make preflight` verifies the ratio on any
network before deploy.

### [H-02] WASM coprocessor could not verify real proofs and trusted caller-supplied cache keys [FIXED]

**Severity**: High
**Location**: `coprocessor/lib.rs` (previous version), `relayer/crossvm.js`
**Confidence**: HIGH

**Description**:
Three independent defects in the cross-VM path:
1. Public inputs arrived as big-endian 32-byte words (EVM encoding) but were parsed with
   `Fr::from_le_bytes_mod_order` — no valid proof could ever verify.
2. `verify(proof, inputs, proof_hash)` cached `verified[proof_hash] = ok` using a
   **caller-supplied** hash with no binding to the proof, so anyone could mark an arbitrary
   hash as "verified" by submitting any valid proof alongside it. Any consumer of
   `is_verified(hash)` (e.g. a Path-A chain extension) could be made to accept forged
   withdrawals.
3. The relayer passed a placeholder (`process.env._PROOF_BYTES`) instead of the proof.

**Impact**:
The headline dual-VM feature was non-functional; with defect 2, a direct-path integration
would have allowed proof forgery → pool drain.

**PoC Result**: N/A for the old code path (could not run end-to-end). The rewrite is
verified: `cargo test -p umbra_groth16` — 7/7, including verification of the **same real
proofs** the Solidity verifiers accept for both circuits.

**Recommendation / Fix**:
Rewrote as `umbra_groth16` (no_std, arkworks) + thin ink! contract. Inputs use EVM calldata
encoding unchanged; every coordinate must be canonical (< p), points on-curve and in the
prime-order subgroup, scalars canonical (< r); the cache key is computed by the contract
from the canonical encoding (`keccak(a|b|c|inputs)`); the relayer dry-runs `check(...)` and
fails closed. `scripts/vk_to_words.js` produces the validated constructor key.

### [H-03] Proving keys not versioned with their verifiers — deposits unwithdrawable [FIXED]

**Severity**: High
**Location**: `.gitignore` (`*.zkey`), `circuits/scripts/setup.sh`, `frontend/public/zk/`
**Confidence**: HIGH (verified with `git ls-files`)

**Description**:
`*.zkey` was git-ignored while the Solidity verifiers generated from those keys were
committed. A deployment built from the repository ships verifiers whose matching proving key
does not exist; regenerating with `make zk` yields a different key that the committed
verifiers reject.

**Impact**:
Any production deployment from the repo would accept deposits that **no one can ever
withdraw** — permanent loss of all deposited funds. The frontend could not generate proofs
at all.

**PoC Result**: `git ls-files` showed only `.wasm` and verification-key files tracked.

**Recommendation / Fix**:
Proving keys are now committed in `sdk/artifacts/` (single source of truth; the frontend
syncs from it at build time). `sdk/artifacts/MANIFEST.json` pins SHA-256 of every key, wasm,
vkey **and** both verifier contracts; `manifest.js --check` runs in CI. `setup.sh` regenerates
the manifest and instructs committing keys and verifiers together.

### [H-04] SDK hashed `ExtData` differently from the contract — every join-split transaction reverted [FIXED]

**Severity**: High
**Location**: `sdk/src/transaction.ts` (`extDataHash`), `circuits/scripts/prove_transaction.js`
**Confidence**: HIGH (reproduced on-chain)

**Description**:
`UmbraShieldedPool` checks `keccak256(abi.encode(extData)) % FIELD`. Because `ExtData`
contains dynamic `bytes`, Solidity encodes it as a dynamic tuple with a leading offset. The
SDK encoded the six fields as a flat parameter list, producing a different hash.

**Impact**:
Every join-split deposit, transfer and withdrawal built by the SDK reverted with
`ExtDataHashMismatch` — the join-split product was unusable. Unit tests missed it because
they computed the hash in Solidity on both sides.

**PoC Result**: E2E on Anvil reverted with selector `0x7e1d313d` (`ExtDataHashMismatch()`).
After the fix the full join-split flow passes (deposit → private transfer → recipient scan →
withdraw → double-spend rejected).

**Recommendation / Fix**:
Encode as `tuple(address,int256,address,uint256,bytes,bytes)`; fixture generator aligned; the
E2E now guards this cross-layer contract permanently.

---

## Medium Findings

### [M-01] Coprocessor bridge attestations were not domain-separated [FIXED]

**Severity**: Medium
**Location**: `contracts/src/UmbraCoprocessorBridge.sol`
**Confidence**: HIGH (regression tests)

**Description**: `attested[keccak(a,b,c,signals)]` was not bound to the bridge, chain or
circuit, so an attestation made for one bridge (e.g. the withdraw-circuit bridge) or chain
could be replayed on another bridge with the same attestor.

**Impact**: Cross-deployment / cross-chain attestation replay; weakens the attestor's
per-circuit guarantees.

**PoC Result**: `test_M01_AttestationNotReplayableAcrossBridges` — replaying bridge-1's hash
on bridge-2 no longer validates the proof.

**Recommendation / Fix**: `proofHashOf = keccak(chainid, address(this), a, b, c, signals)`,
exposed publicly so the attestor computes it identically; constructor rejects a codeless
non-precompile coprocessor address; one bridge per circuit.

### [M-02] Relayer lacked allowlisting, validation, rate limiting and replay protection [FIXED]

**Severity**: Medium
**Location**: `relayer/index.js`
**Confidence**: HIGH (relayer smoke test)

**Description**: The relayer called `withdraw` on any client-supplied address (gas griefing
via attacker contracts), accepted unvalidated inputs, had no body/rate limits, could
broadcast the same nullifier twice concurrently (double gas burn), returned raw internal
errors, and loaded `deployments/portaldot-v3.json`, a file the deploy script no longer
writes (startup crash).

**Impact**: Relayer funds drainable through gas griefing; denial of service; information
leakage; relayer unusable after a fresh deploy.

**PoC Result**: `sdk/test/relayer_smoke.ts` — 9/9 (malformed input, unknown pool,
out-of-field values and wrong-fee proofs rejected **before** any gas is spent; replay → 409).

**Recommendation / Fix**: Pool allowlist from the deployment file, strict field/shape
validation, 16 KB body limit, per-IP token bucket, in-flight nullifier lock, local proof
pre-check, optional profitability guard, generic client errors, `NETWORK`-based deployment
path, fail-closed cross-VM path.

### [M-03] Unbounded event scan and no root cross-check in the SDK [FIXED]

**Severity**: Medium
**Location**: `sdk/src/client.ts` (`scanDeposits`, `pathForNote`)
**Confidence**: MEDIUM

**Description**: Deposits were fetched with one `eth_getLogs` from block 0. Public RPCs cap
log ranges, so scans fail as the chain grows; a partial result would silently build a wrong
tree.

**Impact**: Users unable to withdraw (liveness), or proofs built against an inconsistent
tree.

**PoC Result**: E2E runs with a 50-block chunk size across many chunks.

**Recommendation / Fix**: Chunked scanning from the recorded `deployBlock` with automatic
chunk halving; leaf-index contiguity check; rebuilt root must satisfy `isKnownRoot` on-chain
before proving. Same for the join-split client.

### [M-04] Deploy pipeline could not deploy [FIXED]

**Severity**: Medium
**Location**: `scripts/deploy.js`
**Confidence**: HIGH (reproduced)

**Description**: `import circomlibjs from "circomlibjs"` fails (no default export), and
verifier artifacts were read from `out/verifiers/...` while Foundry writes
`out/<File>.sol/...`.

**Impact**: The first testnet deployment would have crashed (after deploying Poseidon,
wasting gas).

**PoC Result**: Reproduced on Anvil; fixed; the E2E now deploys through this exact script.

**Recommendation / Fix**: Named import; correct artifact paths; `make deploy` runs
`make preflight` first; deploy verifies `eth_chainId` before any transaction.

---

## Low Findings

### [L-01] `UmbraPool.withdraw` was `payable` — stray value locked forever [FIXED]

**Severity**: Low
**Location**: `contracts/src/UmbraPool.sol` (`withdraw`)

**Description**: `withdraw` accepted `msg.value` though nothing uses it (no refund leg).

**Impact**: Value accidentally sent with a withdrawal is permanently locked in the pool.

**PoC Result**: `test_L01_WithdrawRejectsValue`.

**Recommendation / Fix**: `withdraw` is non-payable.

### [L-02] Join-split could pay out to `address(0)` [FIXED]

**Severity**: Low
**Location**: `contracts/src/UmbraShieldedPool.sol` (`transact`)

**Description**: A withdrawal with `recipient = 0`, or a fee with `relayer = 0`, transferred
value to the zero address.

**Impact**: Irrecoverable loss through client bugs or user error.

**PoC Result**: `test_L02_ShieldedRejectsZeroRecipientAndRelayer`.

**Recommendation / Fix**: Revert with `InvalidRecipient` / `InvalidRelayer`.

### [L-03] Withdrawals below the existential deposit to new accounts fail [MITIGATED]

**Severity**: Low
**Location**: `sdk/src/client.ts`, `sdk/src/shieldedClient.ts`

**Description**: Portaldot accounts require a 0.1 tPOT existential deposit; transfers below
it to a non-existent account are rejected by the chain.

**Impact**: Failed (gas-wasting) withdrawals for small join-split amounts to fresh addresses.

**PoC Result**: Observed ED via live balance comparison (H-01 measurement).

**Recommendation / Fix**: SDK checks payout ≥ 0.1 tPOT or that the recipient already exists
before proving; documented in README/SECURITY.

### [L-04] Viewing-key signature message was not domain-separated [FIXED]

**Severity**: Low
**Location**: `sdk/src/viewingKey.ts`

**Description**: The key was derived from a signature over a fixed, generic string, so a
signature obtained by another app or on another chain reproduced it.

**Impact**: Easier phishing of viewing keys (privacy loss; no fund loss after C-01).

**Recommendation / Fix**: Message now includes app, version, chain id and an explicit
"read-only, cannot move funds" purpose statement.

---

## Informational Findings

### [I-01] `ZERO_VALUE` "nothing-up-my-sleeve" claim was false [FIXED]

**Location**: `MerkleTreeWithHistory.sol`, `MerkleTreeWithHistoryPair.sol`, SDK, provers
**Description**: Documented as `keccak256("umbra.v3.zero") % FIELD` but the constant did not
match. It is now derived exactly; `test_I01_ZeroValueIsDerivedFromSeed` enforces it.

### [I-02] Commitment and nullifierHash share the Poseidon(2) domain [ACKNOWLEDGED]

**Location**: `circuits/withdraw.circom`
**Description**: `commitment = H(n, s)`, `nullifierHash = H(n, 0)`; they coincide only if
`s = 0`, which random secrets make negligible. A future circuit version should use distinct
domain tags; changing it requires a new trusted setup.

### [I-03] Demo trusted setup is single-contributor [ACKNOWLEDGED — BLOCKER FOR REAL FUNDS]

**Location**: `circuits/scripts/setup.sh`, `sdk/artifacts/MANIFEST.json`
**Description**: Anyone holding the setup's toxic waste could forge proofs. Acceptable for
testnet/demo; a multi-party ceremony is mandatory before value-bearing deployment
(`PTAU_URL` supported; manifest records the setup provenance).

### [I-04] No CI or reproducible verification [FIXED]

**Description**: Added `.github/workflows/ci.yml` (contracts, artifact pins, SDK/frontend,
Rust coprocessor incl. wasm32 build, full E2E), pinned `forge-std`, `make check` / `make e2e`.

---

## Priority Remediation Order

All items below are complete except the acknowledged ones.

1. **C-01** — viewing keys must never grant spend power — done
2. **H-03** — version proving keys with verifiers — done
3. **H-01** — correct value units — done
4. **H-04** — fix join-split ExtData hashing — done
5. **H-02** — working, hardened WASM coprocessor — done
6. **M-01 … M-04**, **L-01 … L-04**, **I-01**, **I-04** — done
7. **I-03** — run a multi-party trusted-setup ceremony — **required before mainnet**
8. **I-02** — domain-separate in the next circuit version

---

## Appendix: Verification Evidence

| Check | Result |
|---|---|
| `forge test` | 31 passed, 0 failed (incl. 7 audit-regression tests, real-proof verifier tests for both circuits) |
| `cargo test -p umbra_groth16` | 7 passed — same real proofs as Solidity |
| `cargo build -p umbra_groth16 --no-default-features --target wasm32-unknown-unknown` | OK, 0 warnings |
| `cargo check -p umbra_coprocessor` | OK |
| `bash scripts/e2e.sh` | 16 SDK E2E checks + 9 relayer checks passed on a fresh chain |
| `npm run preflight` (Portaldot V3 testnet) | all checks passed |
| `manifest.js --check` | 8 artifacts match |
| SDK `tsc --noEmit`, frontend `vite build` | OK |
