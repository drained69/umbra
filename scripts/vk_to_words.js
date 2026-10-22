#!/usr/bin/env node
/*
 * Convert a snarkjs verification key into the EVM-ordered 32-byte words the ink!/WASM
 * coprocessor constructor takes:  alpha(2) | beta(4) | gamma(4) | delta(4) | IC (2 each)
 * with G2 in EVM precompile order (x.c1, x.c0, y.c1, y.c0).
 *
 *   node scripts/vk_to_words.js withdraw      > withdraw_vk_words.json
 *   node scripts/vk_to_words.js transaction   > transaction_vk_words.json
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function vkToWords(vk) {
  const w = (dec) => "0x" + BigInt(dec).toString(16).padStart(64, "0");
  const g2 = (p) => [w(p[0][1]), w(p[0][0]), w(p[1][1]), w(p[1][0])];
  return [
    w(vk.vk_alpha_1[0]),
    w(vk.vk_alpha_1[1]),
    ...g2(vk.vk_beta_2),
    ...g2(vk.vk_gamma_2),
    ...g2(vk.vk_delta_2),
    ...vk.IC.flatMap((p) => [w(p[0]), w(p[1])]),
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const circuit = process.argv[2];
  if (!["withdraw", "transaction"].includes(circuit)) {
    console.error("usage: vk_to_words.js <withdraw|transaction>");
    process.exit(1);
  }
  const vk = JSON.parse(readFileSync(join(__dirname, "..", "sdk", "artifacts", `${circuit}_verification_key.json`), "utf8"));
  console.log(JSON.stringify(vkToWords(vk), null, 2));
}
