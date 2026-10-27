// Render the pitch deck: one PNG per slide, then one multi-page PDF.
//   node scripts/make-deck.mjs [outDir]   ->  <outDir>/slide-01.png … and Umbra-Pitch-Deck.pdf
// The PDF is built with Pillow (pip-free if Python's Pillow is installed): pages are 1920×1080
// images at 144 dpi, JPEG quality 95.
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = path.resolve(process.argv[2] || path.join(root, "out/deck"));
fs.mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts"), publicDir: path.join(root, "public") });
const COUNT = 11;
const files = [];
for (let i = 0; i < COUNT; i++) {
  const inputProps = { slide: i };
  const composition = await selectComposition({ serveUrl, id: "UmbraDeck", inputProps });
  const output = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
  await renderStill({ composition, serveUrl, output, inputProps, imageFormat: "png" });
  files.push(output);
  console.log("rendered", path.basename(output));
}

const pdf = path.join(outDir, "Umbra-Pitch-Deck.pdf");
execFileSync("python3", ["-c", `
import sys
from PIL import Image
files = sys.argv[2:]
pages = [Image.open(f).convert("RGB") for f in files]
pages[0].save(sys.argv[1], "PDF", save_all=True, append_images=pages[1:], resolution=144.0, quality=95)
`, pdf, ...files]);
console.log("wrote", pdf, (fs.statSync(pdf).size / 1e6).toFixed(1) + " MB");
