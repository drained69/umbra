# Umbra Checkout review

Date: 2026-10-28. Scope: the checkout API, persistence, finalized-event verification, hosted storefront, merchant dashboard, recovery links, download gate and deployment documentation.

This is an internal source and regression-test review, not an independent security audit or a guarantee that every possible failure has been eliminated. The Plamen orchestration reference files named in the workspace instructions were unavailable; this review used direct code inspection, adversarial API tests, browser checks and the local real-proof integration suite.

## Findings addressed

| Finding | Impact | Resolution and evidence |
|---|---|---|
| State mutated before a successful disk write | A failed save could leave an order paid in memory but unpaid after restart, or publish an unsaved product | Construct new state and publish it only after atomic persistence succeeds; disk-failure tests verify downloads stay locked and a later retry succeeds |
| All buyers shared the oldest pending scan cursor | An abandoned old order could delay a new buyer's verification | Scope scans to the requested order or merchant; a regression test settles a recent order while another remains tens of thousands of blocks behind |
| Unbounded chain waits retained the scan lock | One stuck RPC could block future verification requests | Bound each chain read to 20 seconds; test a never-resolving RPC followed by a successful retry |
| Checkout shared the transaction-relay rate bucket | Customer polling could exhaust the small allowance needed to submit a payment | Separate checkout token buckets: 60 requests and 10 creations per minute per observed client IP, with `Retry-After` responses |
| The JSON parser rejected otherwise valid Unicode products | The documented 6,000-character text product could exceed the former 16 KiB parser limit | Route checkout through its own 64 KiB JSON parser; test a full-length non-ASCII product |
| Frontend recovery and status gaps | Stale responses could obscure a paid state; errors could persist after recovery; fees were rounded and no total was shown | Paid state is monotonic, verification errors clear on recovery, product loading can be retried, duplicate payment handlers are guarded, and exact fees and totals are displayed |
| Concurrent create/scan state updates | A persistence refactor could accidentally discard orders created during a chain read | Merge verified changes into the latest state and recheck capacity after async work; regression test covers a concurrent creation and verification |

## Verification model checked

- A unique commitment binds the exact pUSD amount, merchant public key, asset and per-order blinding.
- Matching the exact server-generated ciphertext ensures the merchant can decrypt the payment note. The encrypted memo alone is not used as proof of settlement.
- Only events from the configured pool within the requested finalized block range qualify.
- Wrong amount, recipient, asset, ciphertext, contract, removed event, pre-order event and unfinalized event are rejected.
- Buyer-provided `paid` flags and transaction hashes do not authorize downloads.
- Unpaid downloads and merchant dashboards without the correct capability are denied.
- The server does not receive a merchant spending key. Order URLs and dashboard backups are bearer credentials with different scopes.

## Test coverage

- `npm run test:checkout` in `relayer/`: 15 API, adversarial, persistence, outage, concurrency and rate-limit tests.
- `make e2e`: existing contract/SDK and relayer tests plus an actual Groth16 checkout payment on Anvil, gated delivery, merchant note discovery and a subsequent merchant spend.
- Frontend TypeScript check and production build.
- Browser checks at 320, 390, 768 and 1440 pixels: storefront creation, unpaid delivery controls, form labels and horizontal overflow.
- Controlled browser-response tests: an unavailable product recovers through the retry button, and a delayed awaiting-payment response cannot overwrite a newer paid response. These use simulated API responses, not live settlement.

Result: all 15 checkout tests, 30 local SDK end-to-end checks, the real-proof checkout purchase/spend scenario and 23 relayer checks passed. The standard check also passed 75 contract tests, artifact verification, SDK typechecking and the frontend production build; frontend TypeScript checking passed separately. Browser checks reported no overflow at the tested widths or uncaught errors.

No live customer funds are needed for these tests. Test payments use a throwaway local chain.

## Remaining constraints

- This is a small testnet service with a single-process JSON store. It requires one replica and persistent storage. Use a transactional database, operational monitoring and stronger abuse controls before increasing scale.
- Keep an existing store on its original chain, pool and asset configuration. Use a different directory for another deployment. Store configuration is not automatically migrated across networks.
- A merchant dashboard with very old pending orders can require multiple refreshes to catch up. Direct buyer verification is scoped to its own order.
- Request limits use the IP visible to Express. Clients behind a proxy can share an allowance; arbitrary forwarded headers are not trusted.
- The operator can see order details, control hosted content and withhold delivery. Verification is not escrow, a refund mechanism or a guarantee of product quality.
- An order link allows access to its paid download. Browser history, an extension or someone given the link can expose it; no-referrer headers prevent ordinary referrer transmission but cannot erase those risks.
- The contract does not enforce one payment per checkout order. The UI guards accidental resubmission, but users must check an ambiguous transaction before explicitly retrying, especially across tabs or devices.
- The original testnet setup and contracts still require an independent audit and an appropriate trusted-setup ceremony before use with real funds.
