# Portaldot Integration

Umbra is built on facts measured from the **live Portaldot V3 runtime** (`portaldot-v3`,
spec 3002 on testnet, 3001 on V3 Live), not on assumptions. Every fact below is verified by a
command in this repo.

## What Umbra uses, and how

| Portaldot capability | How Umbra uses it | Verified by |
|---|---|---|
| **pallet-revive** (EVM bytecode, `allowEVMBytecode = true`) | Pools, verifiers and the Poseidon hasher are EVM contracts | `make preflight` |
| BN254 precompiles `0x06/0x07/0x08` | On-chain Groth16 verification | `make preflight` |
| **`revive.call` from native accounts** | **Portaldot Extension users deposit/withdraw with their `5…` account — no EVM wallet** | `make live` |
| `ReviveApi.address` / `accountId`, `revive.mapAccount` | Resolve `5…` ↔ H160; map accounts automatically in the same transaction | `make live` |
| `utility.batchAll` | `mapAccount` + deposit in **one signature** | `sdk/src/portaldot.ts` |
| `ReviveApi.call` / `instantiate` dry-runs | Exact weight + storage-deposit limits, revert reasons *before* signing, cost estimates | `make live`, `make estimate` |
| `nativeToEthRatio = 10^4` | Native POT (14-dec) → `msg.value` in 18-dec units; pools are sized in 18-dec | `make preflight`, `make live` |
| **pallet-assets ERC-20 precompile** `0x{assetId:8 hex}…00010000` | **Shield any Portaldot asset** — pUSD (#7777) by default → confidential stablecoin payments | `make preflight`, `make live` |
| pallet-assets `isSufficient` / `minBalance` | Pre-flight recipient checks (pUSD is non-sufficient: recipients must hold tPOT) | SDK `assertRecipientCanReceive` |
| Existential deposit (0.1 tPOT) | Fresh-recipient checks for tPOT withdrawals | `make preflight` |
| `depositPerByte` / `depositPerItem` | Contracts redesigned so deposits allocate **no** storage | `make measure`, `PortaldotStorage.t.sol` |
| **pallet-contracts** (ink!/WASM) | The WASM Groth16 coprocessor (`coprocessor/`) | `make coprocessor-test` |
| Node console (polkadot.js Apps) | Block links for native transactions in the app | frontend |

## Storage economics (the design constraint)

On Portaldot every **new** 32-byte storage slot locks `64 B × 0.06 = 3.84 tPOT` (plus the
item deposit), charged to the transaction signer. Measured on the live runtime with
`make measure` (read-only dry-runs):

| Operation | Before redesign | After |
|---|---|---|
| Fixed-pool deposit | 8.96 tPOT | **0** |
| Withdrawal (nullifier slot, unavoidable) | 3.84 tPOT | 3.84 tPOT |
| Join-split transaction (2 nullifiers) | 12.8 tPOT | 7.68 tPOT |

How: hard-coded Poseidon zero hashes, pre-initialised tree and root ring buffer, no
per-deposit commitment slot (see `MerkleTreeWithHistory.sol`). The relayer's fee floor
(`RELAYER_MIN_FEE_NATIVE`, default 4 tPOT) covers the withdrawal slot, which is why default
denominations are 100 / 1000.

**Deployment** (code storage dominates; `make estimate`, live dry-run):

| Configuration | Locked + fees |
|---|---|
| Minimal: one 100 tPOT pool | ~1 600 tPOT |
| Default: tPOT 100/1000, pUSD 100/1000, join-split | ~4 275 tPOT |

## Wallet flows

**Portaldot Extension (native, recommended)** — the app finds the extension through the
standard injected-web3 interface, lists its accounts first, and signs `revive.call`
extrinsics. First-time use maps the account in the same batch. Asset deposits that need an
allowance are two transactions (approve, then deposit), each with live dry-run limits.
Viewing keys: sr25519 signatures are randomized, so a signature can't derive a stable key —
the app generates one per account, keeps it in the browser, and offers export/restore.

**EVM wallet (MetaMask / Talisman / SubWallet)** — standard EVM transactions on chain
`420420777`; viewing key derived from a deterministic signature.

**Withdrawals** go to a `0x` address or a `5…` account. A `5…` recipient must be **mapped**
(otherwise funds would land in its fallback account) — the app checks and explains. For
non-sufficient assets (pUSD), the recipient must already hold tPOT: withdraw a tPOT note to
the fresh address first (also unlinkable), then the asset note.

## Deploying from a Portaldot account (no EVM key)

Open the app with `?deploy` (or with no pools configured) and connect the Portaldot Extension.
Pick what to deploy, press **Price it** — a single read-only dry-run of the whole plan from
your account shows the exact tPOT needed against your balance — then **Deploy**: each contract
is a `revive.instantiateWithCode` you sign in the extension; addresses come from
`revive.Instantiated` events, progress is saved per step (an interrupted deployment resumes
without re-paying), and you download the resulting `deployment.json`. Bytecode comes from
`sdk/artifacts/contracts.json`, pinned in `MANIFEST.json`. CLI check of the same flow:
`DEPLOYER=5… npx tsx sdk/test/native_deploy_live.ts` (read-only).

## Fit with Portaldot's roadmap

Portaldot's whitepaper lists a **"ZKP-based privacy protection suite"** for compliant private
commercial activity, an **RWA platform / Asset Engine**, and a native multi-asset base.
Umbra implements that privacy suite on the live chain: ZK-shielded POT *and* Portaldot
assets (pUSD), with read-only viewing keys for compliance, usable directly from Portaldot's
own wallet.

## Re-verify on any network

```bash
NETWORK=testnet make preflight   # runtime facts + asset precompiles
make live                        # native-account integration (read-only)
NETWORK=testnet make estimate    # exact deploy cost
NETWORK=testnet make measure     # per-operation costs
```
