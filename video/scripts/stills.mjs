// Render review stills from one bundle.
// Usage: node scripts/stills.mjs <CompositionId> <outDir> <frame> [frame...]
//    or: node scripts/stills.mjs <CompositionId> <outDir> --sections   (2 frames per section)
import path from "node:path";
import fs from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { sectionTimeline } from "../src/timing.mjs";

const [, , compId, outDir, ...rest] = process.argv;
if (!compId || !outDir) {
  console.error("usage: stills.mjs <CompositionId> <outDir> <frames...|--sections>");
  process.exit(1);
}

let frames;
if (rest[0] === "--sections") {
  frames = sectionTimeline().flatMap((s) => [
    { f: s.startFrame + Math.round(s.durationInFrames * 0.35), name: `${s.id}-a` },
    { f: s.startFrame + Math.round(s.durationInFrames * 0.85), name: `${s.id}-b` },
  ]);
  frames.unshift({ f: 0, name: "cover-frame0" });
} else {
  frames = rest.map((x) => ({ f: Number(x), name: `f${String(x).padStart(4, "0")}` }));
}

fs.mkdirSync(outDir, { recursive: true });
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const composition = await selectComposition({ serveUrl, id: compId, inputProps: {} });

for (const { f, name } of frames) {
  const output = path.join(outDir, `${name}.png`);
  await renderStill({ composition, serveUrl, output, frame: f, imageFormat: "png" });
  console.log(`${name} (frame ${f}) -> ${output}`);
}
