# Umbra — 2-minute product demo

A Remotion (React) film of the real Umbra app: every frame is code, the soundtrack and
interface sounds are synthesised in code (nothing to license), and it renders to MP4 locally.
Built for the Portaldot Hacker House 2026.

## Render

```bash
npm install
npm run audio              # regenerate public/audio/soundtrack.wav from src/timing.mjs
npm run render:landscape   # out/umbra-landscape-1920x1080.mp4
npm run render:portrait    # out/umbra-portrait-1080x1920.mp4
npm run studio             # scrub the timeline in the browser
node scripts/stills.mjs UmbraDemoLandscape out/review --sections   # review frames
```

## One clock for picture and sound

`src/timing.mjs` is the single source of truth: 30 fps, 110 BPM, 3600 frames, 55 bars.
Every section is a whole number of bars, so every cut lands on a bar. Named cues
(`connectClick`, `depositConfirm`, `sendSubmit`, …) are defined in beats; the scenes trigger
their on-screen moment on that beat and `scripts/make-audio.mjs` places the matching SFX on the
same beat, so sound and picture cannot drift.

| # | Section | Bars | Time | Duration |
|---|---|---|---|---|
| — | Cover (frame 0 = thumbnail) | 4 | 0:00.0–0:08.7 | 8.7 s |
| 1 | Land on the app | 5 | 0:08.7–0:19.6 | 10.9 s |
| 2 | Connect a wallet | 5 | 0:19.6–0:30.5 | 10.9 s |
| 3 | Private account | 6 | 0:30.5–0:43.6 | 13.1 s |
| 4 | Deposit tPOT | 7 | 0:43.6–0:58.9 | 15.3 s |
| 5 | Send a private payment | 7 | 0:58.9–1:14.2 | 15.3 s |
| 6 | Pay a request link | 6 | 1:14.2–1:27.3 | 13.1 s |
| 7 | Private swap | 6 | 1:27.3–1:40.4 | 13.1 s |
| 8 | Result | 5 | 1:40.4–1:51.3 | 10.9 s |
| — | Outro + CTA | 4 | 1:51.3–2:00.0 | 8.7 s |

## Voiceover (YouTube cut)

The landscape composition plays `soundtrack-vo.wav`, which adds narration over the same
score, ducking the music about 9 dB under each line (interface SFX are never ducked). The
portrait cut keeps the music-only `soundtrack.wav`.

- Script and per-line timing: `src/voiceover.mjs`. Each line starts a set number of beats into
  its section, or 0.3 s after the previous line if that one is still speaking; four long lines
  are tightened 4–10 % with pitch-preserving `atempo`.
- Voice: Higgsfield preset "Arthur" (`seed_audio`). The recorded clips are committed in
  `voiceover/arthur/` because regenerating them costs credits.
- `npm run audio` builds the stem (`make-voiceover.mjs`), both masters (`make-audio.mjs`)
  and a YouTube caption file, `out/umbra-landscape-1920x1080.en.srt`.

## Example data (not real)

All amounts, names, addresses, block hashes and links are placeholders:

- Accounts: Alice `5Dw9…K2mf` (payer), Bob (recipient), Sam (requester), a second "Savings" account in the picker
- Addresses: `umbra-addr-7h3q…x9f2`, `umbra-addr-k2m8…r4vd`; spend key shown only masked (`umbra-sk-••••`)
- Deposit 50 tPOT · private payment 12.5 tPOT ("Rent for May") · request 2.5 tPOT ("Concert tickets")
- Swap 10 tPOT → 24.984210 pUSD, rate 2.4984, relayer fee 0.0500 tPOT, price impact 0.42%
- Relayer fees use the deployment's 50 bps (0.0625 / 0.0125 tPOT); pool activity 48–50 private transactions
- Block hashes (`0x8f3a…c21d` etc.) and the `?pay=Ak3x…9QfE` link payload

On-screen product copy (labels, hints, status messages, privacy notes) is taken verbatim from
`frontend/src`. The Portaldot Extension signing sheet, Sam's chat message and the "What the
chain sees" panel are video graphics, not Umbra UI.
