// Original soundtrack + interface SFX, synthesised from scratch (nothing to license).
// Calm, confident electronic at 110 BPM. Every section starts on a bar, and every SFX is
// placed from the same cue table the scenes animate on (src/timing.mjs), so they never drift.
//
//   node scripts/make-audio.mjs  ->  public/audio/soundtrack.wav    (music + SFX; portrait cut)
//                                    public/audio/soundtrack-vo.wav (+ narration, music ducked under it;
//                                    YouTube cut) when scripts/make-voiceover.mjs has built the stem.
// All files are 44.1 kHz, 16-bit, stereo, 120 s.
import fs from "node:fs";
import path from "node:path";
import { SAMPLE_RATE as SR, SECONDS_PER_BEAT as SPB, TOTAL_FRAMES, FPS, SECTIONS, CUES, cueAbs } from "../src/timing.mjs";

const DUR = TOTAL_FRAMES / FPS; // 120 s
const N = Math.round(DUR * SR);
const BAR = SPB * 4;
const TOTAL_BARS = Math.round(DUR / BAR); // 55
const TAU = Math.PI * 2;

const L = new Float32Array(N); // music bus (ducks under narration)
const R = new Float32Array(N);
const sfxL = new Float32Array(N); // interface SFX bus (never ducked)
const sfxR = new Float32Array(N);
let bus = [L, R];
const sendL = new Float32Array(N); // reverb send
const sendR = new Float32Array(N);

let seed = 20260427;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rand() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Write a voice into the mix. fn(t, k) returns a mono sample; equal-power pan in [-1, 1].
function put(t0, len, fn, { gain = 1, pan = 0, rev = 0 } = {}) {
  const s0 = Math.round(t0 * SR);
  const n = Math.round(len * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let k = 0; k < n; k++) {
    const i = s0 + k;
    if (i < 0 || i >= N) continue;
    const v = fn(k / SR, k);
    bus[0][i] += v * gl;
    bus[1][i] += v * gr;
    if (rev) {
      sendL[i] += v * gl * rev;
      sendR[i] += v * gr * rev;
    }
  }
}

// RBJ biquad band-pass, coefficients recomputed on demand (for sweeps).
function bandpass() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q) => {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const a = Math.sin(w) / (2 * q);
    const b0 = a, b2 = -a, a0 = 1 + a, a1 = -2 * Math.cos(w), a2 = 1 - a;
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
function onePoleLP() {
  let y = 0;
  return (x, f) => {
    const a = 1 - Math.exp((-TAU * f) / SR);
    y += a * (x - y);
    return y;
  };
}

// ---------------------------------------------------------------- arrangement
// Section start bars, straight from the shared timeline.
const sectionAtBar = [];
{
  let b = 0;
  for (const s of SECTIONS) for (let i = 0; i < s.bars; i++) sectionAtBar[b++] = s.id;
}
const sectionStartBars = [];
{
  let b = 0;
  for (const s of SECTIONS) { sectionStartBars.push({ id: s.id, bar: b }); b += s.bars; }
}
const sec = (bar) => sectionAtBar[Math.min(bar, TOTAL_BARS - 1)];

// Am7 – Fmaj7 – Cadd9 – G6: calm, forward-leaning, resolves every 4 bars.
const PROG = [
  { root: 45, pad: [57, 60, 64, 67] },
  { root: 41, pad: [53, 57, 60, 64] },
  { root: 48, pad: [52, 55, 60, 62] },
  { root: 43, pad: [55, 59, 62, 64] },
];
const chordAt = (bar) => PROG[bar % 4];

const has = {
  bass: (b) => b >= 4,
  hats: (b) => b >= 4 && b < 51,
  kick: (b) => b >= 9 && b < 51,
  clap: (b) => b >= 14 && b < 51,
  arp: (b) => b >= 20 && b < 51,
};

// ---- pad: detuned sine stack, soft attack, crossfaded bar to bar
for (let b = 0; b < TOTAL_BARS; b++) {
  const ch = chordAt(b);
  const last = b === TOTAL_BARS - 1;
  const len = BAR + (last ? 0 : 0.6);
  const level = sec(b) === "cover" ? 0.16 : sec(b) === "outro" ? 0.15 : 0.1;
  ch.pad.forEach((m, j) => {
    const f = mtof(m);
    const ph = rand() * TAU;
    put(Math.max(0, b * BAR - 0.05), len, (t) => {
      const env = Math.min(1, t / 0.35) * (t > BAR ? Math.max(0, 1 - (t - BAR) / 0.6) : 1);
      const trem = 1 + 0.08 * Math.sin(TAU * 0.25 * t + j);
      const v =
        Math.sin(TAU * f * 0.994 * t + ph) +
        Math.sin(TAU * f * t + ph * 1.3) +
        Math.sin(TAU * f * 1.006 * t + ph * 0.7) +
        0.18 * Math.sin(TAU * f * 2 * t);
      return (v / 3.2) * env * trem;
    }, { gain: level, pan: j % 2 ? 0.35 : -0.35, rev: 0.45 });
  });
}

// ---- kick (with the time list reused for sidechain ducking)
const kickTimes = [];
for (let b = 0; b < TOTAL_BARS; b++) {
  if (!has.kick(b)) continue;
  const beats = sec(b) === "result" ? [0, 2] : [0, 1, 2, 3];
  for (const k of beats) kickTimes.push(b * BAR + k * SPB);
}
kickTimes.push(sectionStartBars.find((s) => s.id === "outro").bar * BAR); // outro downbeat
for (const t0 of kickTimes) {
  let ph = 0;
  put(t0, 0.5, (t) => {
    const f = 46 + 90 * Math.exp(-t * 28);
    ph += (TAU * f) / SR;
    return Math.sin(ph) * Math.exp(-t * 6.5) + 0.25 * noise() * Math.exp(-t * 300);
  }, { gain: 0.5 });
}
const duck = (t) => {
  let g = 1;
  for (let i = kickTimes.length - 1; i >= 0; i--) {
    const d = t - kickTimes[i];
    if (d < 0) continue;
    if (d > 0.4) break;
    g = Math.min(g, 1 - 0.55 * Math.exp(-d * 9));
  }
  return g;
};

// ---- bass: quarter-note pulse + "4&" pickup, gently saturated, ducked by the kick
for (let b = 0; b < TOTAL_BARS; b++) {
  if (!has.bass(b)) continue;
  const f = mtof(chordAt(b).root);
  const hits = [0, 1, 2, 3, 3.5];
  for (const h of hits) {
    const t0 = b * BAR + h * SPB;
    const len = h === 3.5 ? SPB * 0.5 : SPB;
    const lvl = sec(b) === "outro" ? 0.18 : 0.24;
    put(t0, len, (t) => {
      const env = Math.min(1, t / 0.008) * (0.55 + 0.45 * Math.exp(-t * 7)) * Math.min(1, (len - t) / 0.03);
      const v = Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2 * t);
      return Math.tanh(1.4 * v) * env * duck(t0 + t);
    }, { gain: lvl });
  }
}

// ---- hats: offbeat 8ths, 16th ghosts in the busy middle
for (let b = 0; b < TOTAL_BARS; b++) {
  if (!has.hats(b)) continue;
  for (let e = 0; e < 8; e++) {
    const off = e % 2 === 1;
    const ghost = !off && b >= 20 && b < 46;
    if (!off && !ghost) continue;
    let x1 = 0, x2 = 0;
    const open = off && e === 7;
    put(b * BAR + e * (SPB / 2) + (ghost ? SPB / 4 : 0), open ? 0.22 : 0.07, (t) => {
      const x = noise();
      const hp = x - 2 * x1 + x2;
      x2 = x1; x1 = x;
      return hp * Math.exp(-t * (open ? 18 : 60));
    }, { gain: ghost ? 0.025 : 0.06, pan: e % 4 < 2 ? -0.25 : 0.25 });
  }
}

// ---- clap on 2 and 4
for (let b = 0; b < TOTAL_BARS; b++) {
  if (!has.clap(b)) continue;
  for (const k of [1, 3]) {
    const bp = bandpass();
    put(b * BAR + k * SPB, 0.3, (t) => {
      const bursts = (t < 0.008 ? 1 : 0) + (t > 0.011 && t < 0.018 ? 1 : 0) + (t > 0.022 ? Math.exp(-(t - 0.022) * 17) : 0);
      return bp(noise(), 1500, 0.9) * bursts;
    }, { gain: 0.16, rev: 0.3 });
  }
}

// ---- arp: FM pluck on 8ths through the middle of the film
for (let b = 0; b < TOTAL_BARS; b++) {
  if (!has.arp(b)) continue;
  const ch = chordAt(b).pad.map((m) => m + 12);
  const pattern = [0, 1, 2, 3, 2, 1, 3, 2];
  pattern.forEach((p, e) => {
    const f = mtof(ch[p]);
    const lvl = sec(b) === "result" ? 0.05 : 0.08;
    put(b * BAR + e * (SPB / 2), 0.6, (t) => {
      const mod = 1.1 * Math.exp(-t * 14) * Math.sin(TAU * f * 2 * t);
      return Math.sin(TAU * f * t + mod) * Math.exp(-t * 7) * Math.min(1, t / 0.003);
    }, { gain: lvl, pan: Math.sin(b * 0.7 + e * 0.6) * 0.5, rev: 0.4 });
  });
}

// ---- section transitions: a swell into each bar-aligned cut + a soft low boom on it
for (const s of sectionStartBars.slice(1)) {
  const t = s.bar * BAR;
  const lp = onePoleLP();
  const len = SPB * 2;
  put(t - len, len, (u) => {
    const k = u / len;
    return lp(noise(), 300 + 5000 * k * k) * k * k;
  }, { gain: 0.09, rev: 0.25 });
  put(t, 1.2, (u) => Math.sin(TAU * (40 + 22 * Math.exp(-u * 5)) * u) * Math.exp(-u * 3.2), { gain: 0.22, rev: 0.2 });
}

// ---------------------------------------------------------------- interface SFX
bus = [sfxL, sfxR];
const at = (name) => cueAbs(name) / FPS; // seconds, from the shared cue table

function click(t0) {
  put(t0, 0.06, (t) => Math.sin(TAU * 2600 * t) * Math.exp(-t * 90) + 0.4 * noise() * Math.exp(-t * 700), { gain: 0.32 });
}
function pop(t0) {
  put(t0, 0.25, (t) => Math.sin(TAU * (620 + 900 * Math.min(1, t / 0.07)) * t) * Math.exp(-t * 16) * Math.min(1, t / 0.004), { gain: 0.22, rev: 0.2 });
}
function bell(t0, midis, { gain = 0.2, spacing = 0.07, rev = 0.5 } = {}) {
  midis.forEach((m, i) => {
    const f = mtof(m);
    put(t0 + i * spacing, 2.2, (t) => {
      const a = Math.min(1, t / 0.004);
      return a * (Math.sin(TAU * f * t) * Math.exp(-t * 2.4) + 0.35 * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t * 5.5) + 0.12 * Math.sin(TAU * f * 5.4 * t) * Math.exp(-t * 9));
    }, { gain, pan: (i - (midis.length - 1) / 2) * 0.3, rev });
  });
}
function shimmer(t0, dur = 1.9) {
  // proof generation: a field of glinting high partials over a rising band of air
  for (let i = 0; i < 16; i++) {
    const f = 2200 + rand() * 4200;
    const start = rand() * (dur - 0.3);
    const len = 0.18 + rand() * 0.35;
    put(t0 + start, len, (t) => Math.sin(TAU * f * t) * Math.sin((Math.PI * t) / len), { gain: 0.03, pan: rand() * 1.6 - 0.8, rev: 0.6 });
  }
  const bp = bandpass();
  put(t0, dur, (t) => {
    const k = t / dur;
    const env = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 2;
    return bp(noise(), 1800 + 5200 * k, 3) * env;
  }, { gain: 0.11, rev: 0.4 });
}
function whoosh(t0, dur = 0.85) {
  const bpL = bandpass();
  put(t0, dur, (t) => {
    const k = t / dur;
    const f = 250 + 3200 * Math.sin(Math.PI * k);
    return bpL(noise(), f, 1.4) * Math.sin(Math.PI * k) ** 1.5;
  }, { gain: 0.34, pan: 0, rev: 0.3 });
  // a short tonal tail so it reads as "sent"
  put(t0 + dur * 0.55, 0.5, (t) => Math.sin(TAU * (880 + 440 * t) * t) * Math.exp(-t * 9), { gain: 0.07, pan: 0.5, rev: 0.4 });
}
function ping(t0) {
  bell(t0, [88, 93], { gain: 0.22, spacing: 0.09, rev: 0.45 }); // E6 → A6 notification
}

// cover hook: your wallet traced on a public ledger, then scrambled into hidden notes
function alert(t0) {
  [0, 0.16].forEach((d, i) => put(t0 + d, 0.22, (t) => Math.sin(TAU * (i ? 523 : 659) * t) * Math.exp(-t * 14) * Math.min(1, t / 0.005), { gain: 0.12, rev: 0.3 }));
}
function glitch(t0, dur = 0.6) {
  const bp = bandpass();
  put(t0, dur, (t, k) => {
    const gate = Math.floor(t * 46) % 3 === 0 ? 0.25 : 1; // stuttering data
    const crush = Math.round(noise() * 6) / 6;
    return bp(crush, 900 + 5000 * (t / dur), 1.8) * gate * Math.sin((Math.PI * t) / dur);
  }, { gain: 0.3, rev: 0.25 });
}
alert(at("coverTrace"));
glitch(at("coverScramble"));
bell(at("coverScramble") + 18 / FPS, [76, 81, 88], { gain: 0.12, spacing: 0.06, rev: 0.6 });

click(at("connectClick"));
click(at("connectPick"));
pop(at("connectPick") + 0.12); // account lands in the header
click(at("accountCreate"));
pop(at("accountBalance"));
bell(at("depositConfirm"), [84, 88, 91, 96], { gain: 0.17 }); // deposit confirmation chime
shimmer(at("sendProof"));
whoosh(at("sendSubmit") - 0.35); // whoosh peaks as "Sent privately" lands
bell(at("requestPay"), [79, 84], { gain: 0.16, spacing: 0.08 }); // paid request
shimmer(at("swapProof"));
bell(at("swapDone"), [83, 88, 91], { gain: 0.15 });
ping(at("resultPing")); // incoming payment

// opening bloom under the cover, closing chord under the CTA
bell(0.05, [57, 64, 69, 76], { gain: 0.1, spacing: 0.11, rev: 0.7 });
bell(sectionStartBars.find((s) => s.id === "outro").bar * BAR + 0.02, [69, 76, 81, 84], { gain: 0.12, spacing: 0.1, rev: 0.7 });

// ---------------------------------------------------------------- reverb (Schroeder) + master
function reverb(input, offset) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => ({ buf: new Float32Array(d + offset), i: 0, lp: 0 }));
  const aps = [556, 441, 341].map((d) => ({ buf: new Float32Array(d + offset), i: 0 }));
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const x = input[n];
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * 0.65 + c.lp * 0.35;
      c.buf[c.i] = x + c.lp * 0.86;
      c.i = (c.i + 1) % c.buf.length;
      s += y;
    }
    s /= combs.length;
    for (const a of aps) {
      const b = a.buf[a.i];
      const y = -s * 0.5 + b;
      a.buf[a.i] = s + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      s = y;
    }
    out[n] = s;
  }
  return out;
}
const wetL = reverb(sendL, 0);
const wetR = reverb(sendR, 23);

// ---------------------------------------------------------------- master + write
const audioDir = path.join(path.dirname(new URL(import.meta.url).pathname), "../public/audio");

// Narration stem + its speech intervals (from scripts/make-voiceover.mjs), if built.
function readWav16(file) {
  const b = fs.readFileSync(file);
  const n = (b.length - 44) / 4;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let k = 0; k < n; k++) { l[k] = b.readInt16LE(44 + k * 4) / 32767; r[k] = b.readInt16LE(46 + k * 4) / 32767; }
  return [l, r];
}
const voPath = path.join(audioDir, "voiceover.wav");
const vo = fs.existsSync(voPath) ? { pcm: readWav16(voPath), spans: JSON.parse(fs.readFileSync(path.join(audioDir, "voiceover.json"), "utf8")) } : null;

// Music gain under narration: dips ~9 dB, easing in just before each line and out after it.
function duckCurve(spans) {
  const g = new Float32Array(N).fill(1);
  const DEPTH = 0.36, PRE = 0.15, POST = 0.5;
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    let amt = 0;
    for (const s of spans) {
      if (t < s.start - PRE || t > s.end + POST) continue;
      const a = t < s.start ? (t - (s.start - PRE)) / PRE : t > s.end ? 1 - (t - s.end) / POST : 1;
      amt = Math.max(amt, Math.max(0, Math.min(1, a)));
    }
    g[n] = 1 - (1 - DEPTH) * amt;
  }
  return g;
}

function master(withVo) {
  const duck = withVo ? duckCurve(vo.spans) : null;
  const oL = new Float32Array(N), oR = new Float32Array(N);
  let peak = 0;
  let voE = 0, bedE = 0;
  const drive = 1.25;
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const musicFade = Math.min(1, t / 0.04) * Math.min(1, (DUR - t) / 2.6);
    const d = duck ? duck[n] : 1;
    let l = ((L[n] + wetL[n] * 0.9) * d) * musicFade + sfxL[n];
    let r = ((R[n] + wetR[n] * 0.9) * d) * musicFade + sfxR[n];
    l = Math.tanh(l * drive);
    r = Math.tanh(r * drive);
    if (withVo) {
      const vl = vo.pcm[0][n] * 1.6, vr = vo.pcm[1][n] * 1.6;
      if (duck[n] < 0.5) { voE += vl * vl + vr * vr; bedE += l * l + r * r; }
      l += vl;
      r += vr;
    }
    const tail = Math.min(1, (DUR - t) / 0.12);
    oL[n] = l * tail;
    oR[n] = r * tail;
    peak = Math.max(peak, Math.abs(oL[n]), Math.abs(oR[n]));
  }
  if (withVo) console.log(`voice sits ${(10 * Math.log10(voE / bedE)).toFixed(1)} dB above the music+SFX bed while speaking`);
  const norm = 0.89 / peak; // -1 dBFS
  for (let n = 0; n < N; n++) { oL[n] *= norm; oR[n] *= norm; }
  return [oL, oR];
}

function writeWav(file, [l, r]) {
  const out = Buffer.alloc(44 + N * 4);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + N * 4, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(N * 4, 40);
  for (let n = 0; n < N; n++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[n])) * 32767), 44 + n * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[n])) * 32767), 46 + n * 4);
  }
  fs.writeFileSync(file, out);
  console.log(`wrote ${file}`);
}

writeWav(path.join(audioDir, "soundtrack.wav"), master(false));
if (vo) writeWav(path.join(audioDir, "soundtrack-vo.wav"), master(true));
else console.log("no voiceover stem (run scripts/make-voiceover.mjs) — skipped soundtrack-vo.wav");

console.log(`${DUR}s, ${TOTAL_BARS} bars @ ${Math.round(60 / SPB)} BPM, each master peak-normalised to -1 dBFS`);
for (const name of Object.keys(CUES)) console.log(`  cue ${name.padEnd(15)} frame ${String(cueAbs(name)).padStart(4)}  ${(cueAbs(name) / FPS).toFixed(3)}s`);
