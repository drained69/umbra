# Umbra Architecture

## 1. Note model (UTXO-style, fixed denomination)

A **note** is the secret opening of a commitment:

```
commitment    = Poseidon(nullifier, secret)
nullifierHash = Poseidon(nullifier, 0)
```

- `commitment` is inserted into a pool's Merkle tree on **deposit**. It reveals nothing.
- To **withdraw**, you prove (in zero knowledge) that you know `(nullifier, secret)` for a
  commitment that is a leaf under a known Merkle `root`, and you reveal `nullifierHash`.
- `nullifierHash` is deterministic per note, so the pool rejects a second spend — but it
  cannot be linked back to any specific deposit.

The **same Poseidon(2)** is used in three places so all roots agree:
on-chain (`IHasher` → PoseidonT3), in-circuit (circomlib `Poseidon(2)`), and in the SDK
(`poseidon-lite`). `FIELD_SIZE` and `ZERO_VALUE` are shared constants.

## 2. Contracts (EVM)

```
MerkleTreeWithHistory  incremental Poseidon tree + rolling window of recent roots
  └─ UmbraPool         deposit(commitment, memo) / withdraw(proof, …); nullifier set
UmbraPoolFactory       one pool per denomination (anonymity set per size)
IVerifier              Groth16 verify interface — VM-agnostic
  ├─ WithdrawVerifier  snarkjs on-chain verifier (default)
  └─ UmbraCoprocessorBridge  routes verify to the ink!/WASM coprocessor (dual-VM)
```

Withdrawal public signals (fixed order, bound into the proof against relayer tampering):
`[root, nullifierHash, recipient, relayer, fee, refund]`.

## 3. ZK (circom + Groth16)

`circuits/withdraw.circom`:
- recomputes `commitment` and `nullifierHash` from private `(nullifier, secret)`,
- verifies a `levels=20` Merkle path to the public `root`,
- binds `recipient/relayer/fee/refund` via quadratic constraints.

`circuits/scripts/setup.sh` compiles the circuit, runs Powers-of-Tau + Groth16 setup, and
exports `contracts/src/verifiers/WithdrawVerifier.sol` plus the `wasm`/`zkey` the client
uses to prove. `prove_example.js` generates a real proof and writes the on-chain test
fixture — this is what the passing `WithdrawVerifier.t.sol` consumes.

## 4. The dual-VM coprocessor (the differentiator)

See [`CROSS_VM.md`](CROSS_VM.md). In short: the pairing check can run in the WASM VM
(`coprocessor/`, ink! + arkworks) instead of the EVM, and the EVM pool consumes the
result through `UmbraCoprocessorBridge` without any interface change.

## 5. Privacy properties & the relayer

- **Unlinkability** requires that the withdrawal isn't trivially tied to the depositor.
  The ZK membership proof hides *which* note; the **relayer** lets the recipient be a
  fresh, gas-less address so there's no funding trail either.
- The relayer is **trustless for correctness**: the proof binds `recipient`, `relayer`,
  and `fee`, so a relayer cannot redirect funds or inflate its cut.

## 6. Viewing keys & selective disclosure

Each action may post a memo encrypted (XChaCha20-Poly1305) to a viewing key derived from a
deterministic wallet signature. The owner, or an auditor they hand the key to, can scan
the `Deposit`/`Withdrawal` events and decrypt exactly their own activity. Disclosure is
per-key and user-initiated — privacy with optional, targeted auditability.

## 7. Roadmap (same engine, more products — ecosystem story)

- **Join-split transfers**: a 2-in/2-out circuit for arbitrary-value private transfers
  between shielded users (Aztec-style) without withdrawing. Circuit family is in place;
  the pool generalizes to variable-value notes.
- **Private DEX / dark pool**: hidden orders matched off the shielded set → MEV resistance.
- **Confidential DAO voting**: prove token-weight without revealing identity or balance.
- **Confidential payroll / RWA**: encrypted balances for businesses with auditor view keys.

All reuse the note model, the coprocessor, and the SDK — Umbra is the **privacy primitive
+ ZK-coprocessor SDK** for the Portaldot ecosystem.
