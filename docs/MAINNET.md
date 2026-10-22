# Mainnet Status & Readiness

## The honest situation (as of 2026-10-22)

**Portaldot mainnet does not expose an EVM JSON-RPC yet.** The mainnet runs as a Substrate
chain (`wss://mainnet.portaldot.io`, POT with 14 decimals, SS58 prefix 42), but an
`eth_chainId` probe returns `method not found` — there is **no EVM layer on mainnet**.

Umbra's pools, verifiers, and factory are **EVM (Solidity)** contracts. They therefore
**cannot be deployed to Portaldot mainnet today** — only to the **V3 testnet** (chain
`420420777`), which is also the hackathon's required deployment target.

We deliberately do **not** fabricate a mainnet RPC or chain id. `scripts/deploy.js` refuses
to deploy to a network whose EVM is not available and verifies `eth_chainId` against the
expected value before sending any transaction.

## What "mainnet-ready" means here

The codebase is built so that going to mainnet is a configuration change, not a rewrite:

1. **Multi-network deploy** — `scripts/networks.json` + `NETWORK=mainnet`. When Portaldot's
   EVM mainnet is live, set the verified params and deploy:
   ```bash
   NETWORK=mainnet MAINNET_EVM_RPC=<rpc> MAINNET_CHAIN_ID=<id> make deploy
   ```
   (The deploy aborts unless `eth_chainId` matches.)
2. **14-decimal POT** handled everywhere via `decimals` config — no hardcoded 18.
3. **VM-agnostic verification** — the same pools work with the on-chain verifier or the
   WASM coprocessor on either network.

## Hard prerequisites BEFORE any real-funds mainnet deployment

A shielded pool holds user funds behind cryptographic assumptions. Do **not** deploy to a
value-bearing network until all of these are done:

1. **Multi-party trusted-setup ceremony.** The demo uses a local single-contributor setup
   (reproducibility only). For mainnet, run a real Powers-of-Tau + phase-2 ceremony, or use
   a published universal ptau. `circuits/scripts/setup.sh` already supports `PTAU_URL=` for a
   community ptau (e.g. a Hermez `powersOfTau28_hez_final_*`).
2. **Professional audit** of the contracts and circuits (nullifier handling, field-range
   checks, value conservation, the pair-insert tree, the coprocessor bridge trust model).
3. **Remove the attestor trust assumption** — use the direct EVM→WASM path (`CROSS_VM.md`
   Path A) if available, or an on-chain verifier; the relayer-attestation path is a testnet
   convenience.
4. **Formal privacy review** — anonymity-set guidance, denomination strategy, timing/metadata
   mitigations (`SECURITY.md`).
5. **Deterministic, reproducible verifier deployment** — pin Poseidon bytecode + verifier to
   the audited setup output; verify on a block explorer.

## TL;DR
- Today: deploy and demo on **V3 testnet**. This is also exactly what the hackathon requires.
- Mainnet: blocked by Portaldot (no EVM yet) and by responsible-deployment prerequisites
  (ceremony + audit). The repo is wired to flip to it the moment both are satisfied.
