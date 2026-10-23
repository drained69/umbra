/* Expected on-chain roots computed by the SDK's own MerkleTree (the code users run to build
 * withdrawal proofs). Contract tests assert the deployed trees produce identical roots. */
import { writeFileSync } from "node:fs";
import { MerkleTree, TREE_LEVELS } from "../src/index";
const leaves = [1n, 2n, 3n, 4n, 5n];
const fixed = leaves.map((_, i) => "0x" + new MerkleTree(leaves.slice(0, i + 1), TREE_LEVELS).root().toString(16));
const pairs = [[11n, 12n], [13n, 14n], [15n, 16n]];
const pair = pairs.map((_, i) => "0x" + new MerkleTree(pairs.slice(0, i + 1).flat(), TREE_LEVELS).root().toString(16));
const empty = "0x" + new MerkleTree([], TREE_LEVELS).root().toString(16);
writeFileSync(new URL("../../contracts/test/fixtures/roots.json", import.meta.url), JSON.stringify({ empty, leaves: leaves.map(String), fixed, pairs: pairs.map((p) => p.map(String)), pair }, null, 2));
console.log("roots.json written");
