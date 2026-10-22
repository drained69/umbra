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

## Chosen idea: PortalID — dual-VM identity middleware (Track 1: Modular Cloud & Middleware)

One portable identity binding the native SS58 wallet (`5...`, polkadot-js) to the EVM address (`0x...`, MetaMask) on Portaldot V3 — one human-readable name + profile, resolvable by **both contract VMs**. Other DApps build on it via middleware.

**Why this idea**: demoing *both* VMs interoperating is Portaldot V3's headline feature and most submissions will be EVM-only only. Strong Innovation score, "middleware other DApps build on" scores Ecosystem Contribution, and it's feasible solo in ~2 weeks.

### Architecture

1. **Claim flow** — user signs a challenge with MetaMask *and* with polkadot-js extension. A lightweight indexer (Node/Express) verifies the sr25519 signature with `@polkadot/util-crypto` (sr25519 can't be verified inside the EVM).
2. **Attestation** — indexer holds a dedicated issuer EOA; `IPassportIssuer` writes the `0x ↔ 5xx` binding into the Solidity registry `PortalIDRegistry.sol` (name, avatar, links, address bindings, events). Trust assumption (trusted issuer) disclosed in docs.
3. **ink! twin** (`portaldot_id.rs`) — same binding mirrored onchain in WASM, called by the indexer's native account, so native DApps can read it directly. This is the dual-VM innovation proof.
4. **Demo DApp "PortalPass"** — gated content only for verified identities + resolving a recipient's EVM address from an SS58 address (and vice versa).
5. **SDK** — npm package `@portaldot/portalid` + a small `PortalIDReader.sol` library = the middleware/ecosystem story.

### Timeline (UTC deadlines)

- **Oct 22–24 (check-in crunch)**: Hardhat scaffold + registry contract deployed on testnet; dual-wallet connect flow signing on both sides; README + architecture diagram. Check-in requires a *working prototype*, not a concept.
- **Oct 26**: feedback results announced — adjust.
- **Oct 27–29**: office hours application (Oct 27 deadline) — free mentor feedback.
- **Oct 30–Nov 4**: iterate to polished version: PortalPass gated-content demo, ink! twin, SDK package.
- **Nov 5**: demo video (≤3 min), pitch deck (problem, why Portaldot is essential, working proof, future plan), final submission docs.
- **Nov 6 04:00**: code freeze. Keep commits spread over time (graded as feasibility evidence).

### Stack

- Contracts: Solidity (Hardhat/Foundry) + one small ink! (Rust) contract
- Frontend: React + wagmi (MetaMask) + `@polkadot/extension-dapp` (polkadot-js)
- Indexer/issuer: Node/Express + `@polkadot/util-crypto` (sr25519 verify)
- Testnet: Portaldot V3 EVM RPC (chain 420420777); test POT from Discord admin DM

### Backup ideas (if PortalID becomes infeasible)

1. **POTWatch** (Track 3) — node monitor, staking APR calculator, Telegram/Discord alerts, rules-based auto-nominator bot. Likely under-contested track.
2. **RWA invoice vault** (Track 4) — tokenize receivables into ERC-20 yield shares. Deepest prizes, most competition.
3. **Cross-chain liquidity router** (Track 2) — biggest wow factor, highest build risk for a solo dev.
