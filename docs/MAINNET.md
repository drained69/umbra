# Mainnet Status & Readiness

## Portaldot runs more than one live network (verified 2026-10-23)

| Network | Endpoint | EVM / pallet-revive | Public EVM RPC | Notes |
|---|---|---|---|---|
| Legacy mainnet | `wss://mainnet.portaldot.io` (explorer: portalscan) | ❌ none | ❌ | `eth_chainId` → method not found |
| **PortaldotV3 Live** (real **POT**) | `wss://live-v3-node.portaldot.dev` | ✅ same V3 runtime as testnet: revive, `allowEVMBytecode`, EVM chain id `780780777`, ratio 10⁴ | ❌ none found | default network of `node-console.portaldot.dev` |
| PortaldotV3 Test (hackathon) | `wss://test-node-v3.portaldot.dev` / `https://test-evm-rpc-v3.portaldot.dev` | ✅ | ✅ chain `420420777` | target for the hackathon |

Earlier docs said "mainnet has no EVM". That's true of the **legacy** chain only. **V3 Live**
runs the EVM-capable runtime, so Umbra's contracts are technically deployable there — through
native extrinsics (`revive.instantiateWithCode` / `revive.call`, the same path the Portaldot
Extension uses), since no public EVM RPC was found. Whether V3 Live is *the* production
mainnet is not stated in the official docs — **confirm with the Portaldot team**.

`scripts/networks.json` lists all three; `deploy.js` refuses networks without a verified EVM
RPC (V3 Live included) rather than guessing.

## Hard prerequisites BEFORE any real-funds deployment (unchanged)

1. **Multi-party trusted-setup ceremony.** The demo keys come from a single-contributor
   setup — whoever ran it could forge proofs. Use `PTAU_URL=` (community Powers of Tau) plus a
   multi-contributor phase 2; `sdk/artifacts/MANIFEST.json` records provenance.
2. **Independent professional audit** of contracts, circuits, coprocessor bridge and the
   storage-minimal tree.
3. **Remove the attestor trust** (cross-VM Path B) or use on-chain verification.
4. **Budget the storage deposits**: ~4 275 POT for the default deployment at current runtime
   prices (`NETWORK=v3live make estimate` once V3 Live access is confirmed).
5. **Relayer economics**: each withdrawal locks ~3.84 POT of storage; set fee floors
   accordingly.

## TL;DR
- Hackathon: deploy and demo on **V3 testnet**.
- V3 Live has the EVM runtime Umbra needs, but go there only after confirming its status with
  Portaldot **and** completing the ceremony + audit.
