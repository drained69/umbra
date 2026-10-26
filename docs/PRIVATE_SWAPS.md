# Umbra private swaps: testnet design and venue check

## Status, 2026-10-26: private swaps are built (not yet deployed)

A swap no longer needs the trader's wallet. The **multi-asset private pool**
([`UmbraMultiAssetPool.sol`](../contracts/src/UmbraMultiAssetPool.sol),
[`multiasset.circom`](../circuits/multiasset.circom)) holds tPOT and pUSD in one tree, and a
proof can mint a note of the other asset. The pool pays the trader's input only to the
proof's named counterparty, and only if it delivers the bought amount in the same call.
The relayer is that counterparty: in one `utility.batchAll` it buys on Portaldot's exchange,
approves, and calls the pool. If the exchange can't fill at the quoted price, everything
reverts and the trader's notes stay unspent.

| | Hidden | Visible |
| --- | --- | --- |
| Private swap | who traded; the trader's balance and history | the relayer's exchange trade, including its size |
| Private payment / withdrawal (relayed) | sender; for payments also recipient and amount | for withdrawals the amount and the 0x recipient |
| Deposit | which notes it becomes | the depositor and amount |

Trade amounts are still visible on the exchange. Hiding them needs the batched design
below, with enough concurrent traders to form an anonymity set.

Verified: 11 Foundry tests; real Groth16 proofs on Anvil for both swap directions,
counterparty binding, tampered amounts and short delivery (`make e2e`); live read-only
quotes from the relayer against the testnet exchange.

### Going live

1. **Fund and deploy.** The testnet deploy costs about 1,022 tPOT in storage deposit
   (271 for the verifier, 750 for the pool; `sdk/test/multiasset_deploy_live.ts`). Open
   `/deploy.html` on the app and sign the two steps with the Portaldot Extension. Then add
   the printed config to `deployments/testnet.json` and `frontend/src/config/deployment.json`
   as `contracts.multiAssetPool`.
2. **Run the relayer.** Build it with `docker build -f relayer.Dockerfile .` and set
   `RELAYER_SEED` to a new native account's secret, in the host's secret settings only.
   Fund that account with tPOT for fees and swap float, plus some pUSD for pUSD-to-tPOT
   swaps. Set `RELAYER_CORS_ORIGIN` to the app's URL. `PRIVATE_KEY`, an EVM account, is
   only needed to relay the older single-asset pool and the fixed pools.
3. **Point the app at it.** Build the frontend with `VITE_RELAYER_URL=<relayer URL>`.

Every private transaction stores two nullifiers, which costs about 7.7 tPOT on this
runtime. The default relayer fee is therefore 9 tPOT, or its pUSD equivalent
(`RELAYER_FEE_SHIELDED`). An operator can set it lower and cover the difference.


Status: fixed-denomination peer-to-peer prototype implemented locally; DEX-backed variable-amount swap remains a design, 2026-10-25. The observed liquidity fallback is tPOT/pUSDT, correctly labeled pUSDT. Do not offer the **private batch swap** below or accept funds for it until the gates below are met.

Update 2026-10-26: the app now has a live **public** swap of tPOT ↔ pUSD #7777 on Portaldot's native `pallet-asset-conversion`, which does hold a Native/pUSD pool (about 153.7 tPOT / 146.4 pUSD). The venue check below only searched the EVM V2 factory. The native swap can be funded from or delivered into the private balance in one atomic extrinsic, but it does not hide the trade amount. See [`FINANCE.md`](FINANCE.md).

This swap is one component of the wider [Umbra privacy-layer design](PRIVACY_LAYER.md), which also specifies the proposed Ethereum Sepolia ↔ Portaldot route and the shared multiasset vault.

## Product requirement

Users should exchange tPOT and pUSD through Umbra while hiding (1) which user traded and (2) each user's trade amount on-chain. The pair and the batch's aggregate execution may be public. Use an existing Portaldot V3 testnet DEX pool for external liquidity.

A direct wallet-to-DEX swap does not satisfy this requirement. The wallet call exposes the trader, and the DEX's reserve changes reveal the amount. Sending an Umbra fixed-pool withdrawal to a DEX also reveals the withdrawal amount and links that transaction to its output. Umbra's deployed join-split pool only holds native tPOT and cannot produce pUSD notes.

## Read-only venue discovery

On Portaldot V3 testnet (chain ID 420420777), `PairCreated(address,address,address,uint256)` logs reveal a V2-style factory at `0xc631805c297c4233b33c30af91245058902c1d18` with six pairs. Calls to `getPair` on 2026-10-25 returned:

| Assets | Result |
| --- | --- |
| WPOT `0xf67ce92096e4e171060b71bf0cca0da9f9548c03` / pUSDT `0xe0114adc0a2072b602c645f5a07eefa1eadbdbc2` | Pair `0x521d8aafeee92e2fa31829faa009fe3698245b93`; nonzero reserves |
| WPOT / Umbra pUSD asset #7777 `0x00001E6100000000000000000000000000010000` | Zero address; no pair in this factory |

On-chain `symbol()` and `decimals()` calls identify `pUSDT` as a 6-decimal token and the Umbra asset as the distinct 6-decimal `pUSD`. A pUSDT swap must not be represented as a pUSD swap. The factory and pair above were discovered on-chain; their provenance and source code have not yet been independently verified. Portaldot's public website mentions iSwap but does not provide a testnet router address or pair registry.

The native deployer's mapped EVM account `0x25a1F91BC0bBd2c87AbDF6fcDDabFACe5B69BAA7` held **zero pUSD** in a read-only `balanceOf` check on 2026-10-25. Therefore the existing account cannot seed a pUSD pair from its current balance. The factory's `getPair(pUSD, WPOT)` returned zero on both checks on 2026-10-25.

The chain's `assets.asset(7777)` state names `5Eph8MeAG5mBCZCN5nsX3bdgx9LeFMnaUJnRFfo9eVaTseZv` as the pUSD owner and issuer, while `assets.account(7777, 5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8)` is empty. Umbra's deployer cannot mint this asset or seed its side of a DEX pool without receiving pUSD from an authorized holder.

## Proposed protocol

### Local atomic note exchange

[`UmbraAtomicSwap.sol`](../contracts/src/UmbraAtomicSwap.sol) and [its Foundry tests](../contracts/test/UmbraAtomicSwap.t.sol) exchange one native fixed-pool note and one ERC-20 fixed-pool note in one transaction. Each proof pays the swap contract as recipient and sets its zero-fee relayer to the low 160 bits of the exact order digest. The outputs are fresh notes in the opposite pools. Both legs revert together if a proof, signature, or deposit fails. The pair and fixed denominations are public. There is no DEX execution or variable-size amount privacy in this milestone.

The existing pool permits anyone holding a withdrawal proof to submit it directly. A leaked proof targeting the swap contract can therefore be submitted outside `swap`, stranding that note's funds. Use private proof delivery and do not deploy this route for value until the pool/circuit is redesigned to prevent this griefing path and independently reviewed. The current tests use a signal-checking mock verifier for contract behavior; they do not establish production ZK soundness or live pUSDT availability.

### Variable-amount batch route

1. **New multiasset shielded vault.** Notes commit to asset ID, amount, owner key and blinding. Deposits accept native tPOT and the selected token. This requires a new circuit, verifier, client and contract; the existing native-only join-split pool cannot be reused unchanged.
2. **Encrypted swap intents.** A user signs an order for input asset, maximum input, minimum output, expiry and cancellation nonce. The intent is encrypted to a batch coordinator; plaintext individual amounts are not posted on-chain.
3. **Batch execution.** The coordinator groups multiple users, nets opposing orders when possible, and sends only the aggregate residual to a verified DEX route. The vault checks a proof that input notes are authorized and unspent, output notes are correct, asset balances are conserved, every order respects its minimum output, and aggregate DEX proceeds cover outputs and fees.
4. **Private settlement.** Outputs become encrypted notes addressed to users. A separate relayer submits the batch so individual wallets do not appear as transaction senders. Users can later spend or withdraw notes with proofs.
5. **Failure and exit.** Expired or unmatched intents never authorize movement. Users retain an independent withdrawal path, and a coordinator cannot change a user's quote or redirect output. Batch calls must be atomic and protected against reentrancy, replay, stale quotes and adverse price movement.

The public chain will still reveal vault deposits and withdrawals at its boundary, the asset pair, and the batch's aggregate DEX trade. A batch with one effective user would reveal that user's amount; the UI must not claim amount privacy unless there is a meaningful anonymity set. A minimum count alone cannot prove users are independent.

## Required before a testnet launch

- Confirm whether the target asset is Umbra's pUSD #7777 or the separate pUSDT token. For pUSD, find or establish a sufficiently liquid DEX pair and verify its router/pair contracts and reserve behavior.
- Implement and test the multiasset circuit, vault, coordinator, relayer and SDK against real DEX quotes. Include adversarial tests for asset conservation, rounding, fee bounds, replay, cancellation, frontrunning, liquidity changes and failed DEX calls.
- Generate new proof artifacts with a **multi-party trusted setup** before claiming real-funds readiness. The existing single-contributor demo setup must not protect a swap vault holding value.
- Obtain an independent audit of the new circuit, contracts, coordinator and DEX integration before any real-funds launch.
- Only enable the frontend Swap action after a live quote and executable route have been verified on the selected chain. The UI must show minimum received, price impact, fees, expiry and whether the current batch is large enough to support the stated privacy level.
