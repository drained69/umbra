// High-level Umbra client used by the frontend and relayer: deposit, scan the pool's
// commitments into a Merkle tree, and assemble a withdrawal proof. Transport-agnostic
// (pass any ethers Provider/Signer).

import { ethers } from "ethers";
import { bytesToHex } from "@noble/hashes/utils";
import { POOL_ABI } from "./abi";
import { Note, commitment as noteCommitment, nullifierHash } from "./note";
import { MerkleTree } from "./merkle";
import { TREE_LEVELS } from "./field";
import { EXISTENTIAL_DEPOSIT_WEI } from "./units";
import { generateWithdrawProof, ProvingArtifacts, WithdrawProof } from "./prover";

export interface PoolDeposit {
  commitment: bigint;
  leafIndex: number;
  encryptedMemo: string; // 0x bytes
  txHash: string;
  blockNumber: number;
}

export interface PoolClientOptions {
  /** Block the pool was deployed at — scanning starts here instead of genesis. */
  deployBlock?: number;
  /** Max block range per eth_getLogs call (RPCs cap this). Auto-halves on error. */
  chunkSize?: number;
}

export class UmbraPoolClient {
  readonly address: string;
  private runner: ethers.ContractRunner;
  private contract: ethers.Contract;
  private deployBlock: number;
  private chunkSize: number;

  constructor(address: string, runner: ethers.ContractRunner, opts: PoolClientOptions = {}) {
    this.address = address;
    this.runner = runner;
    this.contract = new ethers.Contract(address, POOL_ABI, runner);
    this.deployBlock = opts.deployBlock ?? 0;
    this.chunkSize = opts.chunkSize ?? 5_000;
  }

  private get provider(): ethers.Provider {
    const p = (this.runner as any).provider ?? this.runner;
    if (!p || typeof (p as any).getBlockNumber !== "function") throw new Error("runner has no provider");
    return p as ethers.Provider;
  }

  async denomination(): Promise<bigint> {
    return this.contract.denomination();
  }

  /** Shield one note. `encryptedMemo` enables viewing-key reconstruction later. */
  async deposit(note: Note, encryptedMemo: Uint8Array = new Uint8Array()): Promise<string> {
    const denom = await this.denomination();
    if (note.denomination !== denom) throw new Error("note denomination does not match this pool");
    const cmt = noteCommitment(note);
    const memoHex = "0x" + bytesToHex(encryptedMemo);
    const tx = await (this.contract as any).deposit(cmt, memoHex, { value: denom });
    const r = await tx.wait();
    return r.hash;
  }

  /**
   * All commitments in insertion order (needed to reproduce the on-chain tree).
   * Chunked over block ranges (audit M-03) so it works against RPCs that cap
   * eth_getLogs ranges, halving the chunk on errors.
   */
  async scanDeposits(fromBlock = this.deployBlock): Promise<PoolDeposit[]> {
    const filter = this.contract.filters.Deposit();
    const latest = await this.provider.getBlockNumber();
    const out: PoolDeposit[] = [];
    let start = fromBlock;
    let size = this.chunkSize;
    while (start <= latest) {
      const end = Math.min(start + size - 1, latest);
      let logs;
      try {
        logs = await this.contract.queryFilter(filter, start, end);
      } catch (e) {
        if (size <= 1) throw e;
        size = Math.max(1, Math.floor(size / 2));
        continue;
      }
      for (const l of logs as any[]) {
        out.push({
          commitment: BigInt(l.args[0]),
          leafIndex: Number(l.args[1]),
          encryptedMemo: l.args[3],
          txHash: l.transactionHash,
          blockNumber: l.blockNumber,
        });
      }
      start = end + 1;
    }
    out.sort((a, b) => a.leafIndex - b.leafIndex);
    // Integrity: leaf indices must be contiguous from 0, or the RPC dropped logs.
    out.forEach((d, i) => {
      if (d.leafIndex !== i) throw new Error(`event scan incomplete: missing leaf ${i}`);
    });
    return out;
  }

  /** Build the Merkle path for `note`, cross-checking the rebuilt root on-chain. */
  async pathForNote(note: Note) {
    const deposits = await this.scanDeposits();
    const leaves = deposits.map((d) => d.commitment);
    const cmt = noteCommitment(note);
    const leafIndex = leaves.findIndex((x) => x === cmt);
    if (leafIndex < 0) throw new Error("commitment not found in pool — wrong note or pool?");
    const tree = new MerkleTree(leaves, TREE_LEVELS);
    const path = tree.proof(leafIndex);
    if (!(await this.contract.isKnownRoot(path.root))) {
      throw new Error("locally rebuilt Merkle root is not known on-chain — refusing to prove");
    }
    return path;
  }

  async isSpent(note: Note): Promise<boolean> {
    return this.contract.isSpent(nullifierHash(note));
  }

  /** Read-only spent check by nullifier hash (used by the auditor view). */
  async isNullifierSpent(nh: bigint): Promise<boolean> {
    return this.contract.isSpent(nh);
  }

  /**
   * Fail fast (audit L-03) if the payout would be below the existential deposit for a
   * recipient account that doesn't exist yet — the chain would reject the transfer.
   */
  async assertPayoutCreatesAccount(recipient: string, payout: bigint): Promise<void> {
    if (payout >= EXISTENTIAL_DEPOSIT_WEI) return;
    const bal = await this.provider.getBalance(recipient);
    if (bal === 0n) {
      throw new Error("payout is below the 0.1 tPOT existential deposit for a brand-new recipient");
    }
  }

  /** Produce a withdrawal proof bound to recipient/relayer/fee. */
  async buildWithdraw(
    note: Note,
    recipient: string,
    relayer: string,
    fee: bigint,
    artifacts: ProvingArtifacts
  ): Promise<WithdrawProof> {
    if (!ethers.isAddress(recipient) || !ethers.isAddress(relayer)) throw new Error("invalid address");
    const denom = await this.denomination();
    if (fee > denom) throw new Error("fee exceeds denomination");
    await this.assertPayoutCreatesAccount(recipient, denom - fee);
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
