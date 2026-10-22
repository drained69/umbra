// Groth16 proof generation + formatting into UmbraPool.withdraw calldata.
// Works in-browser (wasm/zkey fetched by URL) and in Node (file paths) — snarkjs
// handles both. The heavy pairing VERIFY happens on-chain or in the WASM coprocessor;
// this is only the (client-side) PROVE step.

// @ts-ignore - snarkjs ships no types
import * as snarkjs from "snarkjs";
import { Note, nullifierHash } from "./note";
import type { MerklePath } from "./merkle";

export interface WithdrawInputs {
  note: Note;
  path: MerklePath;
  recipient: string; // 0x...
  relayer: string; // 0x... (== recipient for self-withdraw)
  fee: bigint;
  refund: bigint; // 0 for native pool
}

export interface WithdrawProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[]; // [root, nullifierHash, recipient, relayer, fee, refund]
  root: bigint;
  nullifierHash: bigint;
}

export interface ProvingArtifacts {
  wasm: string; // URL or path to withdraw.wasm
  zkey: string; // URL or path to withdraw_final.zkey
}

function addrToField(addr: string): string {
  return BigInt(addr).toString();
}

export async function generateWithdrawProof(
  inputs: WithdrawInputs,
  artifacts: ProvingArtifacts
): Promise<WithdrawProof> {
  const nh = nullifierHash(inputs.note);

  const circuitInput = {
    root: inputs.path.root.toString(),
    nullifierHash: nh.toString(),
    recipient: addrToField(inputs.recipient),
    relayer: addrToField(inputs.relayer),
    fee: inputs.fee.toString(),
    refund: inputs.refund.toString(),
    nullifier: inputs.note.nullifier.toString(),
    secret: inputs.note.secret.toString(),
    pathElements: inputs.path.pathElements.map((x) => x.toString()),
    pathIndices: inputs.path.pathIndices.map((x) => x.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    artifacts.wasm,
    artifacts.zkey
  );

  // Solidity expects the G2 point coordinates swapped vs snarkjs output.
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
    publicSignals,
    root: inputs.path.root,
    nullifierHash: nh,
  };
}

/** Optional client-side sanity check before paying gas. */
export async function verifyWithdrawProof(
  vkey: object,
  proof: WithdrawProof
): Promise<boolean> {
  const snarkProof = {
    pi_a: [proof.a[0], proof.a[1], "1"],
    pi_b: [
      [proof.b[0][1], proof.b[0][0]],
      [proof.b[1][1], proof.b[1][0]],
      ["1", "0"],
    ],
    pi_c: [proof.c[0], proof.c[1], "1"],
    protocol: "groth16",
    curve: "bn128",
  };
  return snarkjs.groth16.verify(vkey, proof.publicSignals, snarkProof);
}
