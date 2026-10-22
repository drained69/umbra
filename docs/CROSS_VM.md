# Cross-VM Verification: the Portaldot-only part

Umbra's thesis: on a chain with **two VMs**, put each job on the VM that does it best.
The shielded assets live in the EVM; the expensive Groth16 pairing check runs in WASM.

```
                 ┌───────────────────────────── Portaldot V3 (one chain) ─────────────────────────────┐
  user ──prove──▶ │  EVM (pallet-revive)                         WASM (pallet-contracts)              │
   (browser)      │  ┌───────────────┐   verify(proof)?  ┌──────────────────────────────┐             │
                  │  │  UmbraPool     │ ───────────────▶ │ umbra_coprocessor (ink!)      │             │
                  │  │  - Merkle tree │                  │  arkworks bn254 Groth16 verify │             │
                  │  │  - nullifiers  │ ◀─────  bool ──── │  (no EVM gas-loop ceiling)     │             │
                  │  │  - tPOT custody│                  └──────────────────────────────┘             │
                  │  └───────────────┘                                                                 │
                  └────────────────────────────────────────────────────────────────────────────────────┘
```

The pool only ever sees an `IVerifier`. Which VM answers is a deployment choice.

## Path A — direct EVM → WASM (ideal)

If the V3 runtime exposes a precompile / chain-extension that lets the EVM reach
`pallet-contracts`, point `UmbraCoprocessorBridge.coprocessor` at that address. The bridge
does a `staticcall` with `verifyProof(bytes)` and returns the boolean. The pool calls the
bridge exactly like any other verifier.

```
VERIFIER_MODE=coprocessor
COPROCESSOR_ADDRESS=<precompile/chain-extension address>
```

## Path B — relayer attestation (works on testnet today)

When a direct cross-VM call isn't available yet, the **relayer** bridges the two VMs in one
withdrawal flow (`relayer/crossvm.js`):

1. Client sends the proof to the relayer.
2. Relayer calls `umbra_coprocessor.verify(proof, publicInputs, proofHash)` over the
   Substrate RPC (`wss://test-node-v3.portaldot.dev`) — **the pairing check executes in
   the WASM VM**.
3. On success, the relayer calls `UmbraCoprocessorBridge.attest(proofHash)` on the EVM.
4. The relayer submits `UmbraPool.withdraw(...)`; the pool's verifier (the bridge) reads
   the attested result and lets the withdrawal through.

```
VERIFIER_MODE=coprocessor
CROSS_VM=1
PORTALDOT_WS=wss://test-node-v3.portaldot.dev
COPROCESSOR_CONTRACT=<ink! contract SS58 address>
COPROCESSOR_METADATA=coprocessor/target/ink/umbra_coprocessor.json
BRIDGE_ADDRESS=<UmbraCoprocessorBridge EVM address>
```

Path B adds a trust assumption (the attestor), disclosed in [`SECURITY.md`](SECURITY.md).
Path A removes it. **Both are real dual-VM execution**; Path B is the demonstrable one on
the current testnet, Path A is the production target.

## Why not just verify on the EVM?

You can — `VERIFIER_MODE=onchain` deploys the snarkjs `WithdrawVerifier.sol` and the whole
thing works. The point of the coprocessor is that the *same* proof can be checked on the
VM where pairing math is cheap, demonstrating the economic argument for Portaldot's dual-VM
design in a running app. Run the same withdrawal both ways and compare — that's the demo.

## Building the coprocessor

```bash
cd coprocessor
cargo contract build --release   # needs cargo-contract + ink! toolchain
# -> target/ink/umbra_coprocessor.contract  (deploy via node-console.portaldot.dev)
```

Set its verification key from `circuits/build/verification_key.json`, serialized with
ark-serialize (`set_vk` / constructor arg).
