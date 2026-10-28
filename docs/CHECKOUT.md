# Umbra Checkout

Checkout lets a merchant sell a text-based digital product for testnet pUSD through a hosted storefront. It uses the existing multi-asset pool; no new contract or spending permission is required.

## Merchant workflow

1. Open **Pay → Checkout**, or use the **Merchant checkout** footer link (`?merchant=1`).
2. Enter a product name, price, private receiving address and text content, or choose **Use sample product** to create the *Umbra Field Notes* storefront.
3. Create the checkout and download the merchant backup. It contains the dashboard access token, **not** the private account's spending key. Back up that account separately.
4. Share the checkout link or QR code, or paste the generated HTML link button into a website.
5. Refresh Orders to independently verify payments. Funds appear in the merchant's normal private account when it scans the pool.

The first version supports one immutable product per checkout, pUSD prices with up to six decimal places, and `.txt` products up to 6,000 characters. Create another checkout to change the product or price. File uploads, refunds, subscriptions and webhooks are not implemented.

## Buyer workflow

Open the storefront, unlock a funded private account or connect a wallet, and choose a payment source. Private-balance payments include the quoted relayer fee; wallet deposits require gas and may require token approval. The app saves a recovery link into the URL as soon as the order exists. Keep that link private and save it before leaving.

The app checks settlement automatically while the order is open. **Check payment status** retries verification without making another payment. If signing or broadcasting failed ambiguously, check the wallet and order before enabling a payment retry. A successful payment reveals the download button; the server also enforces the download gate.

## Verification protocol

1. The server generates a unique order ID and note blinding, and constructs a pUSD UTXO for the merchant's receiving public key and exact price.
2. It encrypts the note to the merchant's encryption public key, including `checkout:<order ID>` in the encrypted memo. It stores the expected commitment and exact ciphertext before returning the order.
3. The buyer independently recomputes the commitment from the price, asset, merchant public key and supplied blinding. The browser uses this output and the server-prepared ciphertext in the normal Groth16 proof.
4. The verifier scans native `revive.ContractEmitted` logs from the configured multi-asset contract, **only up to the chain's finalized head**. Both the commitment and encrypted output must match. Events preceding order creation or from another contract are rejected.
5. A matching finalized event marks only that order paid. Random per-order blinding prevents a receipt from paying another order. The note is encrypted correctly for the merchant, who can discover and spend it using the existing wallet.

The memo alone is not settlement evidence: it is not included in the note commitment. Exact ciphertext matching also prevents a buyer from supplying an undecryptable note while claiming payment. Buyer-provided flags, amounts and transaction hashes never authorize delivery. No full viewing key or spending key is sent to the checkout server.

## Privacy and trust

- The operator sees the product, price, merchant private address, order note and network metadata. It can link that order's commitment to its on-chain payment. Checkout does **not** hide purchase details from the operator or merchant.
- A private-balance payment avoids including the buyer's public wallet as the submitter; ordinary pool privacy limitations still apply. A wallet-funded purchase exposes the deposit wallet and amount.
- Order URLs are bearer capabilities: anyone with the full order ID can view its status and download a paid product. Do not publish or forward recovery links.
- The merchant token grants dashboard access. It is stored locally and can be exported/restored. The server stores only its hash. No merchant token can spend funds.
- The operator hosts delivery content and can withhold it or alter server responses. On-chain settlement does not guarantee product quality or refunds. The current deployment is a testnet prototype.

## Server deployment

Use the existing relayer with `RELAYER_SEED`, the configured multi-asset pUSD pool, **one service replica**, and a persistent volume mounted at `/data`:

```sh
CHECKOUT_DATA_DIR=/data/checkout
```

An empty variable leaves checkout disabled with a 503 response. The relayer Docker entrypoint grants the Node user access to the checkout subdirectory and then drops root privileges. The JSON store uses a same-directory temporary file and atomic rename with owner-only permissions. Back up `checkout.json` using the hosting provider's volume backup system; it contains private order data and product content. Multi-process or multi-replica operation requires replacing this store with a transactional database.

Verification is incremental, scanning up to 2,000 finalized blocks per request, with one shared in-flight scan and a ten-second successful-scan cooldown. Customer polling or merchant refresh triggers scans. Very old abandoned orders can cause catch-up delays. Capacity is capped at 1,000 products and 10,000 orders. The relayer's existing request rate limit also applies. This is intended for a small testnet deployment, not a high-volume commerce service.

## API

All paths are under `/checkout`, have `Cache-Control: no-store`, and use the relayer's CORS and rate limits.

| Method | Path | Purpose |
|---|---|---|
| POST | `/products` | Create immutable product; returns merchant token once |
| GET | `/products/:id` | Public product metadata; never returns delivery content/token |
| POST | `/products/:id/orders` | Create unique payment note and order capability |
| GET | `/products/:id/orders` | Verify and list orders; requires `Authorization: Bearer <merchant token>` |
| GET | `/orders/:id` | Read order using its secret capability ID |
| POST | `/orders/:id/verify` | Scan finalized events; request body is not evidence |
| GET | `/orders/:id/download` | Return text attachment only for a verified paid order |

## Tests

```sh
cd relayer && npm run test:checkout
# From repository root: real contracts, proofs, settlement and merchant spend
make e2e
```

The checkout unit/integration tests cover correct note decryption, invalid amounts/addresses, dashboard authorization, unpaid download denial, forged client status, wrong asset/recipient/ciphertext/contract, finality bounds, receipt reuse, persistence and merchant-triggered verification. `relayer/checkout.e2e.ts` sends an actual Groth16-proven pUSD payment on Anvil, verifies delivery, discovers the merchant's note and proves that it can be spent.
