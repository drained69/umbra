// Join-split transaction prover: assemble up to 2 input + 2 output UTXOs into a Groth16
// proof for UmbraShieldedPool.transact. Handles deposit / withdraw / internal transfer
// uniformly via the signed `extAmount`.

// @ts-ignore - snarkjs ships no types
import * as snarkjs from "snarkjs";
import { ethers } from "ethers";
import { bytesToHex } from "@noble/hashes/utils";
import { Utxo } from "./utxo";
import { MerkleTree } from "./merkle";
import { FIELD_SIZE, TREE_LEVELS } from "./field";
import type { ProvingArtifacts, WithdrawProof } from "./prover";

export interface ExtData {
  recipient: string;
  extAmount: bigint; // signed: >0 deposit, <0 withdraw, 0 transfer
  relayer: string;
  fee: bigint;
  encryptedOutput1: Uint8Array;
  encryptedOutput2: Uint8Array;
}

export interface TransactionProof {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[]; // [root, publicAmount, extDataHash, inNull[2], outCmt[2]]
  root: bigint;
  publicAmount: bigint;
  extDataHash: bigint;
  inputNullifiers: [bigint, bigint];
  outputCommitments: [bigint, bigint];
}

// Must equal Solidity `abi.encode(extData)` for the ExtData STRUCT. Because the struct has
// dynamic `bytes` members it is ABI-encoded as a dynamic tuple (leading 0x20 offset), so we
// encode a single tuple — NOT a flat parameter list (that produced a different hash and made
// every on-chain transact revert with ExtDataHashMismatch; caught by the E2E test).
const EXT_DATA_TYPES = ["tuple(address,int256,address,uint256,bytes,bytes)"];

export function calculatePublicAmount(extAmount: bigint, fee: bigint): bigint {
  const publicAmount = extAmount - fee;
  return publicAmount >= 0n ? publicAmount : FIELD_SIZE + publicAmount;
}

export function extDataHash(ext: ExtData): bigint {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(EXT_DATA_TYPES, [
    [
      ext.recipient,
      ext.extAmount,
      ext.relayer,
      ext.fee,
      "0x" + bytesToHex(ext.encryptedOutput1),
      "0x" + bytesToHex(ext.encryptedOutput2),
    ],
  ]);
  return BigInt(ethers.keccak256(encoded)) % FIELD_SIZE;
}

/**
 * @param inputs  exactly 2 input UTXOs (use zero-amount dummies to pad)
 * @param outputs exactly 2 output UTXOs
 * @param leaves  ordered commitment list of the pool (to build Merkle paths for real inputs)
 */
export async function buildTransaction(
  inputs: [Utxo, Utxo],
  outputs: [Utxo, Utxo],
  leaves: bigint[],
  ext: ExtData,
  artifacts: ProvingArtifacts
): Promise<TransactionProof> {
  const tree = new MerkleTree(leaves, TREE_LEVELS);
  const root = leaves.length ? tree.root() : treeEmptyRoot();

  const inAmount: string[] = [];
  const inPrivateKey: string[] = [];
  const inBlinding: string[] = [];
  const inPathIndices: string[] = [];
  const inPathElements: string[][] = [];
  const inputNullifiers: bigint[] = [];

  for (const u of inputs) {
    inAmount.push(u.amount.toString());
    inPrivateKey.push(u.keypair.privateKey.toString());
    inBlinding.push(u.blinding.toString());
    if (u.amount > 0n) {
      if (u.index < 0) throw new Error("real input UTXO must have a tree index");
      const path = tree.proof(u.index);
      inPathIndices.push(u.index.toString());
      inPathElements.push(path.pathElements.map((x) => x.toString()));
    } else {
      // dummy input: membership not enforced
      inPathIndices.push("0");
      inPathElements.push(new Array(TREE_LEVELS).fill("0"));
    }
    inputNullifiers.push(u.nullifier());
  }

  const outputCommitment: string[] = [];
  const outAmount: string[] = [];
  const outPubkey: string[] = [];
  const outBlinding: string[] = [];
  const outputCommitments: bigint[] = [];
  for (const u of outputs) {
    outputCommitments.push(u.commitment());
    outputCommitment.push(u.commitment().toString());
    outAmount.push(u.amount.toString());
    outPubkey.push(u.keypair.publicKey.toString());
    outBlinding.push(u.blinding.toString());
  }

  const publicAmount = calculatePublicAmount(ext.extAmount, ext.fee);
  const edHash = extDataHash(ext);

  const input = {
    root: (leaves.length ? root : treeEmptyRoot()).toString(),
    publicAmount: publicAmount.toString(),
    extDataHash: edHash.toString(),
    inputNullifier: inputNullifiers.map((x) => x.toString()),
    inAmount,
    inPrivateKey,
    inBlinding,
    inPathIndices,
    inPathElements,
    outputCommitment,
    outAmount,
    outPubkey,
    outBlinding,
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, artifacts.wasm, artifacts.zkey);

  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
    publicSignals,
    root: BigInt(input.root),
    publicAmount,
    extDataHash: edHash,
    inputNullifiers: [inputNullifiers[0], inputNullifiers[1]],
    outputCommitments: [outputCommitments[0], outputCommitments[1]],
  };
}

// Root of an empty pair-insert tree (matches MerkleTreeWithHistoryPair at nextIndex=0).
import { poseidon2 } from "poseidon-lite";
import { ZERO_VALUE } from "./field";
export function treeEmptyRoot(levels: number = TREE_LEVELS): bigint {
  let cur = ZERO_VALUE;
  for (let i = 0; i < levels; i++) cur = poseidon2([cur, cur]) % FIELD_SIZE;
  return cur;
}
