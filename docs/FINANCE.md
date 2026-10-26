# Everyday finance in Umbra: pay, request, split, swap

Status (2026-10-26): implemented in the app against contracts already deployed on Portaldot V3
testnet and Portaldot's built-in DEX. No new contracts are needed. Every flow below was run in
the browser against the live chain up to the wallet signature (see "What was tested").

## What a user can do

| Feature | Where | How it works on chain |
|---|---|---|
| Balances | Wallet | Public tPOT and pUSD, plus the private (shielded) balance from a scan of the join-split pool |
| Receive | Wallet | Public 5…/0x address or private `umbra-addr-…`, each with a QR code |
| Contacts | Wallet | Names for public and private addresses, kept in this browser |
| Send | Pay → Send | To `umbra-addr-…`: a join-split payment with an encrypted note. To 5…/0x: `balances.transferKeepAlive` / `assets.transferKeepAlive` (or EVM transfer from an EVM wallet) |
| Request money | Pay → Request | A link and QR code holding amount, asset, note and where to pay. Nothing is published until someone pays |
| Split a bill | Pay → Split a bill | One request per person; shares add up exactly to the total (remainder goes to the first share) |
| Track requests | Pay → My requests | Private payments are matched automatically; public payments are verified from a receipt |
| Pay a request | `?pay=` link | Pay privately (from private balance or straight from the wallet) or publicly |
| Swap | Swap | tPOT ↔ pUSD on `pallet-asset-conversion` with live quotes, slippage limit, minimum received and price impact |
| Swap from private balance | Swap | `utility.batchAll([shielded withdrawal, swap])` — one signature, atomic |
| Swap into private balance | Swap | `utility.batchAll([exact-out swap, shielded deposit])` — one signature, atomic |

## Privacy of each action

| Action | Hidden | Visible on chain |
|---|---|---|
| Send / pay from private balance | recipient, amount, note | that your wallet submitted a pool transaction (gas payer) |
| Send / pay from wallet to a private address | recipient, note | your wallet and the amount (as a deposit) |
| Public send / public request payment | nothing | sender, recipient, amount |
| Swap from wallet | nothing | your account, amounts, the pool trade |
| Swap from private balance | which deposit funded it | your account withdrawing and swapping that amount |
| Swap into private balance | where the bought tPOT goes next | the swap and a deposit of the same amount |

Privacy depends on how many other people use the pool. A pool with few deposits gives little
cover, and timing can link a deposit to a later spend.

## How requests settle

- **Private:** the payer's note carries `rq:<request id>:<text>` in its encrypted memo. Only the
  requester can decrypt it; their app marks the request paid when the scanned note is at least the
  requested amount.
- **Public:** the payment and `system.remarkWithEvent("umbra:rq:<id>")` go in one
  `utility.batchAll`. The payer gets a receipt link (request id + block hash). The requester's app
  checks that one successful extrinsic in that block both pays at least the amount to them and
  emits the remark's hash, so a receipt cannot be reused for another request. EVM wallets cannot
  add the remark, so they get no receipt.
- Requests, contacts and activity live in the browser's local storage. Clearing site data loses
  them; the private balance can always be rebuilt from the spend key.

## Encrypted memos

Join-split notes now carry an optional memo (≤ 96 bytes, control characters removed) inside the
encrypted output. Plaintexts are padded to 384 bytes, so every new ciphertext has the same length
whether or not it has a memo. Notes created before this change still decrypt.

## The private account

The spend key can be remembered in the browser (opt-in, shown at creation). Anyone using that
browser profile could then spend the private balance. The app asks the user to save the key before
moving funds, and **Lock** removes it from the browser.

## Swap venue and limits

- Venue: Portaldot's native `pallet-asset-conversion` pool Native/#7777 (pUSD). On 2026-10-26 it
  held about 153.7 tPOT / 146.4 pUSD, with a 0.3% LP fee. 1 tPOT quoted 0.943 pUSD.
- The pool is small: 5 tPOT moves the price about 3.4%. The app warns above 3% price impact and
  asks for confirmation above 5%.
- Swaps require the Portaldot Extension (native account). EVM wallets cannot call the DEX pallet.
- This is a public swap with optional private funding or delivery. It is not the batched private
  swap in [`PRIVATE_SWAPS.md`](PRIVATE_SWAPS.md), which hides individual amounts.

## What was tested

- `sdk/test/payments_swap_live.ts` (26 checks): memo encryption and padding, legacy note
  decryption, request links, splits, receipts, the runtime's remark hash, live DEX quotes, and
  runtime fee estimation for the swap and public-payment extrinsics.
- In the browser, with a read-only extension whose signer refuses: live balances, private-account
  creation and scan, receive QR codes, a 5 tPOT swap quote, request creation and its link, the
  pay-a-request page, split-bill links and request tracking, and a phone-width layout.
  The private payment built a real Groth16 proof with an encrypted memo, and the shielded pool
  accepted it in a live dry-run. The swap and public payment were built and handed to the signer.
- Not yet tested: a signed transaction for any of these flows. The runtime has no
  `DryRunApi`, so a full batch cannot be executed without a signature. The first real swap, private
  payment and receipt verification will be the end-to-end proof.
