# Sepolia → Portaldot operator bridge prototype

This is a **trusted testnet prototype** for moving one fixed-size ERC-20 deposit on Ethereum Sepolia into one backed Umbra token note on Portaldot V3. The operator chooses the destination collateral token and can mis-credit, censor, or settle source funds early. It is not an official Portaldot bridge, a trust-minimized bridge, or a two-way route.

## Deployment order

1. Verify the Sepolia source ERC-20, Portaldot destination ERC-20, decimals, and economic backing. The two token addresses must be configured explicitly; identical symbols do not establish equivalence. Fund the operator with destination tokens and gas on both chains.
2. Deploy `UmbraOperatorLockbox(sourceToken, operator, 420420777, denomination, refundDelay)` on Sepolia. `lock` stays closed while its destination is unset.
3. Deploy an `UmbraTokenPool` for the destination token and the same raw denomination on Portaldot. Its verifier and hasher must match the existing verified pool configuration. This creates a new pool; the current pUSD pool is **not** a pUSDT pool.
4. Deploy `UmbraBridgeInbox(operator, 11155111, bytes32(uint256(uint160(lockboxAddress))), destinationToken, destinationPool)` on Portaldot. Check the pool's token and denomination before deploying.
5. Call `lockbox.configureDestination(inboxAddress)` from the operator on Sepolia. This can be done only once. Verify all getters on both contracts before anyone locks a deposit.
6. A user creates a fresh Umbra note locally, approves and calls `lockbox.lock(commitment, encryptedMemo)` on Sepolia, and preserves the note secret. The commitment is public; the secret must never be sent to the operator.
7. Run the relay command in dry-run mode, inspect its chain IDs, addresses, token mapping, source lock, confirmations, destination collateral and commitment, then run it with `--send`. It waits for destination credit confirmations and checks the credit event before settling source collateral.

```bash
cd scripts
BRIDGE_SOURCE=0x... BRIDGE_INBOX=0x... \
BRIDGE_SOURCE_TOKEN=0x... BRIDGE_DEST_TOKEN=0x... \
SEPOLIA_RPC=https://... PORTALDOT_RPC=https://... \
node bridge-relay.js --nonce 1

# After inspecting the dry-run and funding the same operator key on both chains:
BRIDGE_SOURCE=0x... BRIDGE_INBOX=0x... \
BRIDGE_SOURCE_TOKEN=0x... BRIDGE_DEST_TOKEN=0x... \
SEPOLIA_RPC=https://... PORTALDOT_RPC=https://... \
BRIDGE_OPERATOR_KEY=0x... node bridge-relay.js --nonce 1 --send
```

For RPCs with restricted log ranges, set `BRIDGE_SOURCE_FROM_BLOCK` and `BRIDGE_DEST_FROM_BLOCK` to the deployment blocks. `BRIDGE_SOURCE_CONFIRMATIONS` defaults to 12 and `BRIDGE_DEST_CONFIRMATIONS` to 3. The command is safe to retry while the source lock remains pending; it checks whether the destination message was already consumed.

## Failure and privacy boundaries

- The user can request a delayed refund only with an operator-signed **non-delivery** certificate. This is not an independent timeout. The operator must never sign after a destination credit.
- The operator fronts destination liquidity and receives source collateral on settlement. There is no on-chain exchange rate or price protection. Start with valueless test assets and a documented 1:1 test mapping.
- Source deposit amount, depositor, destination commitment, operator, and transaction timing are public. The credited note can be privately spent later, subject to the anonymity of its pool.
- The relay currently handles **Sepolia → Portaldot only**. A reverse route needs a separately reviewed Portaldot outbox, Sepolia payout contract, refund race protection, and operator funding. Do not describe the current prototype as bidirectional.
