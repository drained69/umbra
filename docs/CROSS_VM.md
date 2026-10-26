# Cross-VM Verification: the Portaldot-only part

Umbra's thesis: on a chain with **two VMs**, put each job on the VM that does it best.
The shielded assets live in the EVM; the Groth16 pairing check can run in WASM.

```
                 ┌──────────────────────────── Portaldot V3 (one chain) ────────────────────────────┐
  user ──prove──▶ │  EVM (pallet-revive)                        WASM (pallet-contracts)              │
   (browser)      │  ┌────────────────┐  same calldata   ┌─────────────────────────────────┐        │
                  │  │ UmbraPool /     │ ───────────────▶ │ umbra_coprocessor (ink!)         │        │
                  │  │ ShieldedPool    │                  │  └─ umbra_groth16 (no_std, arkworks)│     │
                  │  │  verifier =     │ ◀──── bool ───── │     canonical-field + subgroup checks│    │
                  │  │  CoprocessorBridge                 └─────────────────────────────────┘        │
                  │  └────────────────┘                                                              │
                  └──────────────────────────────────────────────────────────────────────────────────┘
```

The pools only ever see an `IVerifier`. Which VM answers is a deployment choice
(`VERIFIER_MODE=onchain | coprocessor`).

## What is proven (not just designed)

- `coprocessor/groth16` (the verification core that compiles to WASM) is unit-tested
  natively against **the exact same real proofs** that the Solidity verifiers accept — both
  the withdraw and the join-split circuit — and rejects tampered inputs, wrong-circuit
  proofs, non-canonical scalars and off-curve points (`make coprocessor-test`, 7 tests).
- It builds `no_std` for `wasm32-unknown-unknown`, and the ink! contract builds into a
  54,156-byte deployable wasm (`make coprocessor`). On the live testnet a read-only dry-run
  instantiates it (`sdk/test/crossvm_live.ts`), and a measurement contract running the same
  `umbra_groth16` code accepted a real withdraw proof and rejected a tampered one inside
  pallet-contracts (figures below). Once deployed, `COPROCESSOR=<ss58>` makes the same test
  run real and tampered proofs through the deployed contract.
- Inputs use the **EVM calldata encoding** (32-byte big-endian words, G2 in precompile order
  `x.c1, x.c0, y.c1, y.c0`), so proofs cross VMs byte-for-byte with no re-serialization.

## Path A — direct EVM → WASM (production target)

If the V3 runtime exposes a precompile / chain-extension that lets the EVM reach
`pallet-contracts`, deploy `UmbraCoprocessorBridge` with `coprocessor` = that address. The
bridge `staticcall`s `verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[])` and
returns the boolean. No trusted party involved.

## Path B — relayer attestation (works on testnet today)

When direct cross-VM calls aren't available, the relayer bridges the VMs inside one
withdrawal (`relayer/crossvm.js`):

1. Client sends its proof to the relayer (as for any gasless withdrawal).
2. Relayer asks the bridge for the **domain-separated** hash
   `proofHashOf(a,b,c,signals)` = keccak(chainid, bridge, proof, signals).
3. Relayer dry-runs `umbra_coprocessor.check(a, b, c, inputs)` over the Substrate RPC — the
   **pairing check executes in the WASM VM**.
4. Only if WASM returns `Ok(true)`: relayer calls `bridge.attest(proofHash)`, then submits
   `withdraw(...)`. The bridge returns `true` for exactly that proof on exactly that bridge.
5. **Fails closed**: if the coprocessor is unreachable or rejects, nothing is submitted.

Path B trusts the attestor (the relayer key) — disclosed in [`SECURITY.md`](SECURITY.md).
Path A removes that trust. Both are real dual-VM execution.

## Deploying from the Portaldot Extension

The app deploys the cross-VM path from a native account, every step signed in the Portaldot
Extension: open `/?deploy&crossvm` (or **Contracts → Set up WASM verification**). Each step is
priced by a live dry-run, can be resumed, and is re-checked on chain before it is relied on.

| Step | VM | Extrinsic | Storage deposit (testnet, 2026-10-26) |
|---|---|---|---|
| `umbra_coprocessor::new(withdraw key)` | WASM | `contracts.instantiateWithCode` | 4,293.26 tPOT |
| `UmbraCoprocessorBridge(0x0, attestor)` | EVM | `revive.instantiateWithCode` | 128.86 tPOT |
| `UmbraPool(bridge, poseidon, 10 tPOT, 20)` | EVM | `revive.instantiateWithCode` | 562.97 tPOT |

About **4,992 tPOT** in total including fees. Deposits stay locked with the contracts. The code
upload dominates: pallet-contracts charges 0.06 tPOT per stored byte (54,156-byte wasm) plus a
30% code-hash lockup. The pool reuses the deployed Poseidon hasher.

The bridge's attestor defaults to the deploying account's EVM identity, so that account attests
from its extension; `?attestor=0x…` sets another key (for example a relayer's). The app writes
a `crossVm` section into `deployment.json` and lists the new pool as **10 tPOT · WASM**.

**Withdrawing** from that pool takes two signatures:

1. `utility.batchAll([contracts.call(coprocessor.verify_or_revert(proof)), revive.call(bridge.attest(proofHash))])`.
   The pairing check runs in the WASM VM; `verify_or_revert` reverts on an invalid proof, so the
   attestation is rolled back with it. Each verification increments `verify_count` and emits
   `Verified`, so WASM execution is visible on chain.
2. `revive.call(pool.withdraw(...))` — the pool asks the bridge, which finds the attestation.

The attestation hash binds the chain id, the bridge, the proof and the exact public signals the
pool passes to its verifier, so it cannot be reused for another bridge, chain or recipient.

Check a deployment (read-only — runs a real and a tampered proof through the WASM VM):

```bash
node scripts/verify-native-deployment.js deployments/testnet.json <5… deployer>
cd sdk && COPROCESSOR=<ss58> npx --yes tsx@4.19.1 test/crossvm_live.ts
```

The automated relayer path (`CROSS_VM=1`, `relayer/crossvm.js`) predates the `crossVm`
deployment section and is not wired to the extension-deployed pool yet; it requires the bridge
attestor to be the relayer's key.

### Building the coprocessor

```bash
make coprocessor   # Rust 1.86.0 + cargo-contract 5.0.3, then scripts/export-coprocessor.js
```

cargo-contract 5.0.3 cannot build `core` on newer toolchains (the `panic_immediate_abort`
feature became a panic strategy), hence the pinned `INK_TOOLCHAIN`. The export writes
`sdk/artifacts/coprocessor.json` (wasm, blake2-256 code hash, message selectors, withdraw
verifying-key words), which `sdk/artifacts/MANIFEST.json` pins. The constructor validates the
key (rejects malformed, off-curve and non-canonical words). `set_vk` (owner-only, emits
`VerifyingKeyRotated`) supports a post-ceremony key rotation.

## Measured cost: WASM vs EVM

The same real withdraw proof, read-only dry-runs on Portaldot V3 testnet (2026-10-26):

| Verifier | Result | Block weight (refTime) |
|---|---|---|
| EVM `WithdrawVerifier.verifyProof` (snarkjs, BN254 precompiles) | accepted | 0.035 s |
| WASM `umbra_groth16` (arkworks, pallet-contracts) | accepted; tampered input rejected | ≈ 0.3 s |

The WASM figure is a measurement contract's instantiate weight (0.43 s) minus the coprocessor's
own instantiation (0.13 s); `verify-native-deployment.js` prints the exact weight of `check`
once the coprocessor is deployed. Both fit easily within a block (2 s; 1.7 s per normal
extrinsic).

## Why verify in WASM at all?

Not for gas. Portaldot V3's EVM has native BN254 precompiles, so a BN254 Groth16 check costs
about a tenth as much there; `VERIFIER_MODE=onchain` stays the default for cost. The WASM VM
runs verification as ordinary Rust with no precompile dependency, which is what proof systems
and curves without EVM precompiles (for example BLS12-381-based proofs) would need. It also
gives Umbra a second, independent verifier implementation, checked here against the exact
proofs the EVM verifier accepts.
