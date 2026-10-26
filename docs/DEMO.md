# Demo Script (≤3 min video)

Goal: make the privacy visible and the "why Portaldot" undeniable.

## Setup (before recording)
- `make deploy` on Portaldot V3 testnet; `make relayer`; `make frontend`.
- Two MetaMask accounts: **Alice** (has tPOT) and **Bob** (fresh, 0 balance).
- Node console open (https://node-console.portaldot.dev/) to show raw on-chain data.

## 0:00–0:20 — The problem
"Every EVM transfer is public — amounts and the sender↔receiver link. Umbra makes native
POT payments private, and it does it using the one thing unique to Portaldot V3: two VMs."

## 0:20–1:00 — Shield (deposit)
- Alice → Deposit tab → 10 tPOT → "Generate note" (show it's created in-browser) → Deposit.
- Cut to the explorer: show the tx carries only a **commitment** — no amount link, no
  future-withdrawal link. Point at the "What leaks?" panel: public vs. secret.

## 1:00–1:50 — Private withdraw to a fresh address
- Switch to the Withdraw tab, paste the note, set recipient = **Bob's brand-new address**,
  keep "Gasless via relayer" on.
- Watch the 4 steps: parse → Merkle path → **ZK proof in the browser** → relayer submits.
- Show Bob's balance go from 0 → ~9.95 tPOT (relayer fee), and that Bob's address **never
  needed gas** and has **no on-chain link** to Alice's deposit.

## 1:50–2:30 — The dual-VM payoff (the differentiator)
- Explain + show: the Groth16 verification ran in the **WASM coprocessor** (ink!/arkworks),
  not the EVM. Show the coprocessor's `verify_count` incrementing (node console) and the
  bridge `attest` tx on the EVM side.
- One line: "Assets in the EVM, cryptography in WASM — the right VM for the right job, on
  one chain. That's Portaldot."

## 2:30–3:00 — Compliance, not a black box
- Auditor tab → "Reveal MY history" (decrypts Alice's own memos) → then "Copy viewing key"
  → paste into the auditor field → the same history appears.
- Close: "Private by default, auditable by choice. Umbra is the privacy primitive for the
  Portaldot ecosystem — and the ZK-coprocessor pattern any V3 dApp can reuse."

## Judge one-liners (keep in your back pocket)
- *Feasibility*: "Real circuits, 31 contract + 7 WASM tests, a 25-check end-to-end run on the
  real deploy pipeline, audited with every finding fixed — and the on-chain verifier
  accepts a genuinely-generated proof — not a mock."
- *Innovation*: "WASM-as-ZK-coprocessor for an EVM asset layer is new, and only natural on
  a dual-VM chain."
- *Ecosystem*: "It ships as an SDK + pattern — private DEX, DAO voting, payroll all drop
  onto the same engine."
- *Business*: "Confidential payments with selective disclosure is where Aztec and
  confidential stablecoins are going; the relayer fee is the revenue model."

## Extended demo: private account transfer

If time permits, open **Private account**. Alice creates a shielded address and backs up
the spend key, then deposits 5 tPOT. Bob creates his own address and shares the public
`umbra-addr-…` string. Alice sends 2 tPOT to Bob and keeps 3 as change. Bob restores his
account in another browser and scans his 2 tPOT balance; he can then withdraw it.
The output notes and amounts are encrypted, but Alice's gas-paying wallet is public.
This flow uses the deployed join-split pool; it does not require a new contract.
