// Voiceover script for the YouTube (landscape) cut. One line per section; each line starts
// `lead` beats after its section's first bar (or just after the previous line, if that one
// is still speaking), so narration rides the same clock as the visuals and SFX (timing.mjs).
// `say` is the text sent to the voice engine, with pronunciation spelled out; `text` is the
// line as written. `tempo` gently tightens the few lines that run longer than their scene.
//
// Recorded with the Higgsfield preset voice "Arthur" (seed_audio); clips live in
// voiceover/arthur/NN-<section>.flac. Regenerating them costs credits, so they are committed.
export const VOICE = { name: "Arthur", model: "seed_audio", voice_type: "preset", voice_id: "30fc8796-ceb6-4a66-b3a7-4a145ef7f346" };
export const VO_DIR = "voiceover/arthur";

export const VOICEOVER = [
  {
    section: "cover",
    lead: 2,
    text: "Every payment on a public chain is visible to everyone. Umbra changes that.",
    say: "Every payment on a public chain is visible to everyone. Umbra changes that.",
  },
  {
    section: "land",
    lead: 1,
    tempo: 1.08,
    text: "Umbra is a zero-knowledge privacy layer for Portaldot. Pay, request and swap — and choose exactly what the world gets to see.",
    say: "Umbra is a zero-knowledge privacy layer for Portaldot. Pay, request and swap, and choose exactly what the world gets to see.",
  },
  {
    section: "connect",
    lead: 1,
    text: "Connect the Portaldot Extension or MetaMask. Your keys never leave your wallet, and Umbra never holds your funds.",
    say: "Connect the Portaldot Extension, or MetaMask. Your keys never leave your wallet, and Umbra never holds your funds.",
  },
  {
    section: "account",
    lead: 1,
    text: "Create a private account in one click. A single spend key controls it, and your private address receives encrypted payments in tPOT and pUSD.",
    say: "Create a private account in one click. A single spend key controls it, and your private address receives encrypted payments in T-Pot and P-U-S-D.",
  },
  {
    section: "deposit",
    lead: 1,
    text: "Top up with fifty tPOT. A zero-knowledge proof is generated right in your browser, you sign once, and the deposit is verified on chain.",
    say: "Top up with fifty T-Pot. A zero-knowledge proof is generated right in your browser. You sign once, and the deposit is verified on chain.",
  },
  {
    section: "send",
    lead: 1,
    tempo: 1.04,
    text: "Now pay a friend. Paste their private address, enter twelve and a half tPOT, and add an encrypted note. A relayer submits it, so your wallet never signs and nothing links back to you.",
    say: "Now, pay a friend. Paste their private address, enter twelve and a half T-Pot, and add an encrypted note. A relayer submits it, so your wallet never signs, and nothing links back to you.",
  },
  {
    section: "request",
    lead: 1,
    text: "Getting paid is just as easy. Open a payment link and see who's asking, how much, and what for. One tap pays it privately.",
    say: "Getting paid is just as easy. Open a payment link, and see who's asking, how much, and what for. One tap pays it privately.",
  },
  {
    section: "swap",
    lead: 1,
    text: "Need dollars? Swap tPOT for pUSD at live exchange prices, without ever leaving your private balance.",
    say: "Need dollars? Swap T-Pot for P-U-S-D at live exchange prices, without ever leaving your private balance.",
  },
  {
    section: "result",
    lead: 1,
    tempo: 1.08,
    text: "On the other side, Bob sees his payment and the note. The chain sees only a verified proof. No sender. No amount. No trace.",
    say: "On the other side, Bob sees his payment, and the note. The chain sees only a verified proof. No sender. No amount. No trace.",
  },
  {
    section: "outro",
    lead: 0,
    tempo: 1.1,
    text: "Umbra. Pay anyone. Hide everything. Try it today — the link is in the description.",
    say: "Umbra. Pay anyone. Hide everything. Try it today. The link is in the description.",
  },
];
