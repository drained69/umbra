// Single source of truth for the whole production's clock.
// Imported by the Remotion compositions (visuals) AND by scripts/make-audio.mjs
// (soundtrack + interface SFX), so sound and picture can never drift.

export const FPS = 30;
export const BPM = 110;
export const TOTAL_FRAMES = 3600; // 120.00s
export const SAMPLE_RATE = 44100;

export const SECONDS_PER_BEAT = 60 / BPM; // 0.54545s
export const FRAMES_PER_BEAT = (FPS * 60) / BPM; // 16.3636
export const FRAMES_PER_BAR = FRAMES_PER_BEAT * 4; // 65.4545

// 55 bars total. Every section is a whole number of bars, so every cut lands on a bar.
export const SECTIONS = [
  { id: "cover", bars: 4, label: "Cover" },
  { id: "land", bars: 5, label: "Land on the app" },
  { id: "connect", bars: 5, label: "Connect a wallet" },
  { id: "account", bars: 6, label: "Private account" },
  { id: "deposit", bars: 7, label: "Deposit tPOT" },
  { id: "send", bars: 7, label: "Send a private payment" },
  { id: "request", bars: 6, label: "Pay a request link" },
  { id: "swap", bars: 6, label: "Private swap" },
  { id: "result", bars: 5, label: "Result" },
  { id: "outro", bars: 4, label: "Outro" },
];

// Resolve each section to integer frame boundaries (rounded to the nearest bar-frame).
export function sectionTimeline() {
  const out = [];
  let cumBars = 0;
  for (const s of SECTIONS) {
    const startFrame = Math.round(cumBars * FRAMES_PER_BAR);
    cumBars += s.bars;
    const endFrame = Math.round(cumBars * FRAMES_PER_BAR);
    out.push({
      ...s,
      startBar: cumBars - s.bars,
      startFrame,
      endFrame,
      durationInFrames: endFrame - startFrame,
    });
  }
  return out;
}

export function sectionById(id) {
  const t = sectionTimeline().find((s) => s.id === id);
  if (!t) throw new Error(`unknown section ${id}`);
  return t;
}

// Absolute frame for a cue inside a section, given beats-from-section-start.
export function cueFrame(sectionId, beatsFromStart) {
  return sectionById(sectionId).startFrame + Math.round(beatsFromStart * FRAMES_PER_BEAT);
}

// Named interface moments, in beats from their section start. The scenes trigger their
// choreography on these beats AND the audio script places the matching SFX on them, so
// picture and sound are locked to the same clock.
export const CUES = {
  connectClick: { section: "connect", beat: 3 },
  connectPick: { section: "connect", beat: 10 },
  accountCreate: { section: "account", beat: 6 },
  accountBalance: { section: "account", beat: 15 },
  depositConfirm: { section: "deposit", beat: 21 },
  sendProof: { section: "send", beat: 8 },
  sendSubmit: { section: "send", beat: 20 },
  requestPay: { section: "request", beat: 13 },
  swapProof: { section: "swap", beat: 8 },
  swapDone: { section: "swap", beat: 20 },
  resultPing: { section: "result", beat: 6 },
};

// Local frame of a cue within its own section (for scenes rendered inside a Sequence).
export function cueLocal(name) {
  return Math.round(CUES[name].beat * FRAMES_PER_BEAT);
}

// Absolute frame of a cue on the master timeline (for the audio script).
export function cueAbs(name) {
  const c = CUES[name];
  return sectionById(c.section).startFrame + Math.round(c.beat * FRAMES_PER_BEAT);
}
