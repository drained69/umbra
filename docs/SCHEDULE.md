# Day-by-Day Schedule (Oct 22 → Nov 11, UTC)

Anchored to the real deadlines: check-in **Oct 24 12:00**, office hours apply by **Oct 27**,
code freeze **Nov 6 04:00** (no bulk commits in the final 24h), Demo Day **Nov 8–9**,
winners **Nov 11**.

| Date | Focus | Concrete output | Commit? |
|---|---|---|---|
| **Oct 22** ✅ | Build core | Contracts + ZK (withdraw + join-split) + SDK + frontend + relayer + coprocessor; **24/24 tests** | ✅ done (4+ commits) |
| **Oct 23** | Testnet bring-up | `make zk` (prod-style), `forge build`, `make deploy` to V3 testnet; smoke-test deposit→withdraw on-chain; **push public repo** | ✅ |
| **Oct 24** | **Check-in (12:00)** | Submit working prototype + 60s teaser clip; confirm testnet addresses in README | ✅ |
| **Oct 25** | Shielded-transfer UI | Frontend "Send privately" tab on the join-split engine (keypair, scan `NewCommitment`, decrypt, build tx) | ✅ |
| **Oct 26** | Cross-VM Path B | Build + deploy ink! coprocessor; relayer attests WASM verify; demo EVM gate via `attest` | ✅ |
| **Oct 27** | **Office hours apply** | Submit application; write the "why Portaldot / dual-VM" one-pager for mentors | ✅ |
| **Oct 28** | Cross-VM polish | Measure gas: EVM verify vs WASM coprocessor; add the comparison panel to the UI | ✅ |
| **Oct 29** | Hardening | Relayer edge cases, multi-denom UX, input validation, error states | ✅ |
| **Oct 30** | Compliance UX | Viewing-key / auditor flow polish; selective-disclosure demo path | ✅ |
| **Oct 31** | Tests + docs | Join-split SDK tests (transfer round-trip), coverage, architecture diagrams | ✅ |
| **Nov 1** | Pitch deck | Problem · why Portaldot is essential · working proof · roadmap · business | ✅ |
| **Nov 2** | Demo rehearsal | Record a rough cut of the ≤3-min demo; tighten the script | ✅ |
| **Nov 3** | Buffer / bugfix | Fix whatever the rehearsal exposed; security self-review | ✅ |
| **Nov 4** | **Feature freeze** | Finalize README, diagrams; last substantive commits land today | ✅ |
| **Nov 5** | Final package | Final ≤3-min demo video, deck, submission docs; only docs/polish commits | ✅ (light) |
| **Nov 6 04:00** | **Code freeze** | Submit. No bulk commits in the final 24h (graded). | — |
| **Nov 8–9** | **Demo Day** | Present; run the live flow | — |
| **Nov 11** | Winners | — | — |

## Priorities if time gets tight (cut from the bottom)
1. Keep: testnet deploy, working deposit→private withdraw demo, the dual-VM story (Path B is enough), viewing-key disclosure, pitch + video.
2. Nice-to-have: in-UI shielded transfer (join-split) — the engine is already tested; a CLI/script demo suffices if the UI slips.
3. Stretch: gas comparison panel, multi-denom UX polish.

## Commit hygiene (rules compliance)
- Public repo, ≥3 commits spread across the event (already satisfied).
- Land real work by **Nov 4**; **Nov 5–6 are docs/polish only** to respect the no-bulk-final-24h rule.
