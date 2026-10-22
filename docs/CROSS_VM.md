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
- It builds `no_std` for `wasm32-unknown-unknown`; the ink! contract type-checks (CI).
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

## Deploying the coprocessor

```bash
make coprocessor                                   # cargo contract build --release
node scripts/vk_to_words.js withdraw > vk.json     # constructor argument (EVM-ordered words)
# instantiate target/ink/umbra_coprocessor/umbra_coprocessor.contract with vk.json
# (node-console.portaldot.dev or polkadot.js), one instance per circuit
VERIFIER_MODE=coprocessor make deploy              # pools use UmbraCoprocessorBridge
CROSS_VM=1 COPROCESSOR_CONTRACT=<ss58> SUBSTRATE_SEED=<seed> make relayer
```

The constructor validates the key (rejects malformed / off-curve / non-canonical words).
`set_vk` (owner-only, emits `VerifyingKeyRotated`) supports a post-ceremony key rotation.

## Why not just verify on the EVM?

You can — `VERIFIER_MODE=onchain` uses the snarkjs verifiers, and `make preflight`
confirms Portaldot V3 supports the BN254 precompiles they need. The coprocessor demonstrates
the dual-VM design in a running app: the same proof, checked on the VM where pairing math
is native Rust, with the EVM asset layer unchanged.
