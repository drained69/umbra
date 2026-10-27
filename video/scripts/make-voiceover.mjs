// Build the narration stem for the YouTube cut from the recorded clips.
//
//   node scripts/make-voiceover.mjs
//     -> public/audio/voiceover.wav   (44.1 kHz, 16-bit, stereo, 120 s, speech only)
//     -> public/audio/voiceover.json  (speech intervals; make-audio ducks the music under them)
//
// Each clip is trimmed of silence, tempo-adjusted (pitch preserved), high-passed and lightly
// compressed with ffmpeg, then placed on the shared clock: `lead` beats after its section's
// first bar, or 0.3 s after the previous line if that one is still speaking.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SAMPLE_RATE as SR, SECONDS_PER_BEAT as SPB, TOTAL_FRAMES, FPS, sectionById } from "../src/timing.mjs";
import { VOICEOVER, VO_DIR } from "../src/voiceover.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DUR = TOTAL_FRAMES / FPS;
const N = Math.round(DUR * SR);
const GAP = 0.3; // minimum breath between lines
const TARGET_RMS = 0.12; // speech level before the final mix

const clips = fs.readdirSync(path.join(root, VO_DIR)).filter((f) => f.endsWith(".flac")).sort();

// Decode one processed clip to interleaved float32 stereo at the project rate.
function load(file, tempo) {
  const chain = [
    "silenceremove=start_periods=1:start_threshold=-45dB",
    "areverse",
    "silenceremove=start_periods=1:start_threshold=-45dB",
    "areverse",
    ...(tempo && tempo !== 1 ? [`atempo=${tempo}`] : []),
    "highpass=f=80",
    "acompressor=threshold=-20dB:ratio=3:attack=5:release=150:makeup=2",
    `aresample=${SR}`,
  ].join(",");
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-af", chain, "-ac", "2", "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

const out = new Float32Array(N * 2);
const intervals = [];
let prevEnd = 0;

VOICEOVER.forEach((line, i) => {
  const file = clips.find((c) => c.startsWith(String(i).padStart(2, "0") + "-"));
  if (!file) throw new Error(`missing clip for line ${i} (${line.section}) in ${VO_DIR}`);
  const pcm = load(path.join(root, VO_DIR, file), line.tempo);

  // loudness-match lines to each other
  let sum = 0;
  for (let k = 0; k < pcm.length; k++) sum += pcm[k] * pcm[k];
  const gain = TARGET_RMS / Math.sqrt(sum / pcm.length);

  const sec = sectionById(line.section);
  const sectionStart = sec.startFrame / FPS;
  const sectionEnd = sec.endFrame / FPS;
  const start = Math.max(sectionStart + line.lead * SPB, prevEnd + (i ? GAP : 0));
  const len = pcm.length / 2 / SR;
  const end = start + len;
  if (end > DUR - 0.25) throw new Error(`line ${i} (${line.section}) ends at ${end.toFixed(2)}s, past the end of the film`);

  const s0 = Math.round(start * SR);
  for (let k = 0; k < pcm.length / 2; k++) {
    const n = s0 + k;
    if (n >= N) break;
    out[n * 2] += pcm[k * 2] * gain;
    out[n * 2 + 1] += pcm[k * 2 + 1] * gain;
  }
  intervals.push({ section: line.section, start: +start.toFixed(3), end: +end.toFixed(3) });
  prevEnd = end;

  const spill = end - sectionEnd;
  console.log(
    `${String(i).padStart(2)} ${line.section.padEnd(8)} ${start.toFixed(2).padStart(6)}s → ${end.toFixed(2).padStart(6)}s  (${len.toFixed(2)}s)` +
      (spill > 0 ? `  runs ${spill.toFixed(2)}s into the next scene` : "")
  );
});

// write 16-bit WAV
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const norm = peak > 0.95 ? 0.95 / peak : 1;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N * 2; n++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[n] * norm)) * 32767), 44 + n * 2);

fs.writeFileSync(path.join(root, "public/audio/voiceover.wav"), buf);
fs.writeFileSync(path.join(root, "public/audio/voiceover.json"), JSON.stringify(intervals, null, 2));

// YouTube caption track from the same timings.
const ts = (s) => {
  const ms = Math.round(s * 1000);
  const p = (v, n = 2) => String(v).padStart(n, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const srt = intervals.map((iv, i) => `${i + 1}\n${ts(iv.start)} --> ${ts(iv.end)}\n${VOICEOVER[i].text}\n`).join("\n");
fs.mkdirSync(path.join(root, "out"), { recursive: true });
fs.writeFileSync(path.join(root, "out/umbra-landscape-1920x1080.en.srt"), srt);
console.log(`wrote public/audio/voiceover.wav (${VOICEOVER.length} lines), voiceover.json and out/umbra-landscape-1920x1080.en.srt`);
