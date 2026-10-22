// High-level Umbra client used by the frontend and relayer: deposit, scan the pool's
// commitments into a Merkle tree, and assemble a withdrawal proof. Transport-agnostic
// (pass any ethers Provider/Signer).

import { ethers } from "ethers";
import { POOL_ABI } from "./abi";
import { Note, commitment as noteCommitment, nullifierHash } from "./note";
import { MerkleTree } from "./merkle";
import { TREE_LEVELS } from "./field";
import { generateWithdrawProof, ProvingArtifacts, WithdrawProof } from "./prover";

export interface PoolDeposit {
  commitment: bigint;
  leafIndex: number;
  encryptedMemo: string; // 0x bytes
  txHash: string;
  blockNumber: number;
}

export class UmbraPoolClient {
  readonly address: string;
  private runner: ethers.ContractRunner;
  private contract: ethers.Contract;

  constructor(address: string, runner: ethers.ContractRunner) {
    this.address = address;
    this.runner = runner;
    this.contract = new ethers.Contract(address, POOL_ABI, runner);
  }

  async denomination(): Promise<bigint> {
    return this.contract.denomination();
  }

  /** Shield one note. `encryptedMemo` enables viewing-key reconstruction later. */
  async deposit(note: Note, encryptedMemo: Uint8Array = new Uint8Array()): Promise<string> {
    const denom = await this.denomination();
    const cmt = noteCommitment(note);
    const memoHex = "0x" + Buffer.from(encryptedMemo).toString("hex");
    const tx = await (this.contract as any).deposit(cmt, memoHex, { value: denom });
    const r = await tx.wait();
    return r.hash;
  }

  /** All commitments in insertion order (needed to reproduce the on-chain tree). */
  async scanDeposits(fromBlock = 0): Promise<PoolDeposit[]> {
    const filter = this.contract.filters.Deposit();
    const logs = await this.contract.queryFilter(filter, fromBlock);
    const out: PoolDeposit[] = logs.map((l: any) => ({
      commitment: BigInt(l.args[0]),
      leafIndex: Number(l.args[1]),
      encryptedMemo: l.args[3],
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
    }));
    out.sort((a, b) => a.leafIndex - b.leafIndex);
    return out;
  }

  /** Build the Merkle path for `note` from the current pool state. */
  async pathForNote(note: Note) {
    const deposits = await this.scanDeposits();
    const leaves = deposits.map((d) => d.commitment);
    const cmt = noteCommitment(note);
    const leafIndex = leaves.findIndex((x) => x === cmt);
    if (leafIndex < 0) throw new Error("commitment not found in pool — wrong note or pool?");
    const tree = new MerkleTree(leaves, TREE_LEVELS);
    return tree.proof(leafIndex);
  }

  async isSpent(note: Note): Promise<boolean> {
    return this.contract.isSpent(nullifierHash(note));
  }

  /** Produce a withdrawal proof bound to recipient/relayer/fee. */
  async buildWithdraw(
    note: Note,
    recipient: string,
    relayer: string,
    fee: bigint,
    artifacts: ProvingArtifacts
  ): Promise<WithdrawProof> {
    const path = await this.pathForNote(note);
    return generateWithdrawProof({ note, path, recipient, relayer, fee, refund: 0n }, artifacts);
  }

  /** Self-submit a withdrawal (recipient pays gas; relayer == recipient). */
  async withdrawSelf(proof: WithdrawProof, recipient: string, signer: ethers.Signer): Promise<string> {
    const c = new ethers.Contract(this.address, POOL_ABI, signer);
    const tx = await (c as any).withdraw(
      proof.a,
      proof.b,
      proof.c,
      proof.root,
      proof.nullifierHash,
      recipient,
      recipient,
      0,
      0
    );
    const r = await tx.wait();
    return r.hash;
  }
}
