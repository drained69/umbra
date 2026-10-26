// High-level client for UmbraShieldedPool (join-split): scan + decrypt your UTXOs, then
// deposit, privately transfer, or withdraw arbitrary amounts in one `transact` call.

import { ethers } from "ethers";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Keypair } from "./keypair";
import { Utxo } from "./utxo";
import { buildTransaction, type ExtData, type TransactionProof } from "./transaction";
import type { ProvingArtifacts } from "./prover";
import { EXISTENTIAL_DEPOSIT_WEI } from "./units";

export const SHIELDED_POOL_ABI = [
  "function transact((uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 publicAmount,uint256 extDataHash,uint256[2] inputNullifiers,uint256[2] outputCommitments) args,(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2) extData) payable",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function getLastRoot() view returns (uint256)",
  "event NewCommitment(uint256 indexed commitment, uint256 index, bytes encryptedOutput)",
  "event NewNullifier(uint256 indexed nullifier)",
];

function largestTwo(notes: Utxo[]): Utxo[] {
  return [...notes].sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1)).slice(0, 2);
}

export interface ScannedCommitment {
  commitment: bigint;
  index: number;
  encryptedOutput: string; // 0x
}

export interface TransactParams {
  inputs: Utxo[]; // 0..2 of your own unspent UTXOs
  outputs: Utxo[]; // 0..2 outputs (yours or a recipient's via Keypair.fromAddress)
  owner: Keypair; // used to pad with dummies / change
  extAmount?: bigint; // >0 deposit, <0 withdraw, 0 transfer
  recipient?: string; // EVM address for withdrawals
  relayer?: string;
  fee?: bigint;
  artifacts: ProvingArtifacts;
}

export class UmbraShieldedClient {
  readonly address: string;
  private contract: ethers.Contract;
  private runner: ethers.ContractRunner;
  private deployBlock: number;
  private chunkSize: number;

  constructor(address: string, runner: ethers.ContractRunner, opts: { deployBlock?: number; chunkSize?: number } = {}) {
    this.address = address;
    this.runner = runner;
    this.contract = new ethers.Contract(address, SHIELDED_POOL_ABI, runner);
    this.deployBlock = opts.deployBlock ?? 0;
    this.chunkSize = opts.chunkSize ?? 5_000;
  }

  private get provider(): ethers.Provider {
    return ((this.runner as any).provider ?? this.runner) as ethers.Provider;
  }

  /** All output commitments in tree order (chunked log scan + contiguity check). */
  async scanCommitments(): Promise<ScannedCommitment[]> {
    const filter = this.contract.filters.NewCommitment();
    const latest = await this.provider.getBlockNumber();
    const out: ScannedCommitment[] = [];
    let start = this.deployBlock;
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
        out.push({ commitment: BigInt(l.args[0]), index: Number(l.args[1]), encryptedOutput: l.args[2] });
      }
      start = end + 1;
    }
    out.sort((a, b) => a.index - b.index);
    out.forEach((c, i) => {
      if (c.index !== i) throw new Error(`commitment scan incomplete: missing index ${i}`);
    });
    return out;
  }

  /** Decrypt every output addressed to `owner`; returns UNSPENT ones by default. */
  async myUtxos(owner: Keypair, includeSpent = false): Promise<Utxo[]> {
    return (await this.myNotes(owner)).filter((n) => includeSpent || !n.spent).map((n) => n.utxo);
  }

  /** Every note addressed to `owner` (oldest first), each with its spent flag — one scan. */
  async myNotes(owner: Keypair): Promise<{ utxo: Utxo; spent: boolean }[]> {
    const scanned = await this.scanCommitments();
    const mine: { utxo: Utxo; spent: boolean }[] = [];
    for (const s of scanned) {
      if (!s.encryptedOutput || s.encryptedOutput === "0x") continue;
      const u = Utxo.decrypt(hexToBytes(s.encryptedOutput.slice(2)), owner, s.index);
      // must decrypt AND match the on-chain commitment (rejects forged ciphertexts)
      if (!u || u.commitment() !== s.commitment || u.amount === 0n) continue;
      mine.push({ utxo: u, spent: await this.contract.isSpent(u.nullifier()) });
    }
    return mine;
  }

  async balance(owner: Keypair): Promise<bigint> {
    return (await this.myUtxos(owner)).reduce((s, u) => s + u.amount, 0n);
  }

  /** Largest amount one transaction can spend: a join-split takes at most two input notes. */
  static spendable(notes: Utxo[]): bigint {
    return largestTwo(notes).reduce((s, u) => s + u.amount, 0n);
  }

  /**
   * Plan a payment of `amount` to a shielded address, optionally with an encrypted memo.
   *  - "private": spends `owner`'s notes; the recipient and amount stay hidden.
   *  - "wallet":  the payer's wallet deposits the amount straight into the recipient's note;
   *               the recipient stays hidden but the amount is public as a deposit.
   */
  async planPayment(p: { source: "private" | "wallet"; owner: Keypair | null; to: string; amount: bigint; memo?: string }): Promise<Omit<TransactParams, "artifacts">> {
    if (p.amount <= 0n) throw new Error("amount must be positive");
    const payee = new Utxo({ amount: p.amount, keypair: Keypair.fromAddress(p.to), memo: p.memo });
    if (p.source === "wallet") {
      return { inputs: [], outputs: [payee], owner: p.owner ?? new Keypair(), extAmount: p.amount };
    }
    if (!p.owner) throw new Error("unlock a private account to pay from your private balance");
    const { inputs, change } = this.selectInputs(await this.myUtxos(p.owner), p.amount);
    const outputs = [payee];
    if (change > 0n) outputs.push(new Utxo({ amount: change, keypair: p.owner }));
    return { inputs, outputs, owner: p.owner, extAmount: 0n };
  }

  /** Plan a withdrawal of `amount` from `owner`'s private balance to an EVM `recipient`. */
  async planWithdrawal(owner: Keypair, amount: bigint, recipient: string): Promise<Omit<TransactParams, "artifacts">> {
    if (amount <= 0n) throw new Error("amount must be positive");
    const { inputs, change } = this.selectInputs(await this.myUtxos(owner), amount);
    const outputs = change > 0n ? [new Utxo({ amount: change, keypair: owner })] : [];
    return { inputs, outputs, owner, extAmount: -amount, recipient };
  }

  private selectInputs(notes: Utxo[], amount: bigint): { inputs: Utxo[]; change: bigint } {
    const inputs = largestTwo(notes);
    const total = inputs.reduce((s, u) => s + u.amount, 0n);
    if (total < amount) {
      const all = notes.reduce((s, u) => s + u.amount, 0n);
      throw new Error(
        all >= amount
          ? "your private balance is split across more than two notes and one transaction can spend two — send yourself a smaller amount first to merge notes"
          : "insufficient private balance"
      );
    }
    return { inputs, change: total - amount };
  }

  /** Build + prove a join-split transaction (does not send). */
  async prepare(p: TransactParams): Promise<{ proof: TransactionProof; ext: ExtData }> {
    const extAmount = p.extAmount ?? 0n;
    const fee = p.fee ?? 0n;
    const recipient = p.recipient ?? ethers.ZeroAddress;
    const relayer = p.relayer ?? ethers.ZeroAddress;
    if (p.inputs.length > 2 || p.outputs.length > 2) throw new Error("max 2 inputs and 2 outputs");
    for (const u of p.inputs) {
      if (!u.keypair.canSpend) throw new Error("input UTXO is not spendable by this keypair");
    }
    const inputs = [...p.inputs];
    while (inputs.length < 2) inputs.push(new Utxo({ amount: 0n, keypair: new Keypair() }));
    const outputs = [...p.outputs];
    while (outputs.length < 2) outputs.push(new Utxo({ amount: 0n, keypair: p.owner }));

    const sumIn = inputs.reduce((s, u) => s + u.amount, 0n);
    const sumOut = outputs.reduce((s, u) => s + u.amount, 0n);
    if (sumIn + extAmount - fee !== sumOut) {
      throw new Error(`value not conserved: in ${sumIn} + ext ${extAmount} - fee ${fee} != out ${sumOut}`);
    }
    if (extAmount < 0n) {
      if (recipient === ethers.ZeroAddress) throw new Error("withdrawal needs a recipient");
      if (-extAmount < EXISTENTIAL_DEPOSIT_WEI && (await this.provider.getBalance(recipient)) === 0n) {
        throw new Error("withdrawal below the 0.1 tPOT existential deposit to a brand-new address");
      }
    }

    const ext: ExtData = {
      recipient,
      extAmount,
      relayer,
      fee,
      encryptedOutput1: outputs[0].encryptTo(outputs[0].keypair.encPublic),
      encryptedOutput2: outputs[1].encryptTo(outputs[1].keypair.encPublic),
    };
    const leaves = (await this.scanCommitments()).map((c) => c.commitment);
    const proof = await buildTransaction([inputs[0], inputs[1]], [outputs[0], outputs[1]], leaves, ext, p.artifacts);
    if (!(await this.contract.isKnownRoot(proof.root))) {
      throw new Error("locally rebuilt root not known on-chain — refusing to submit");
    }
    return { proof, ext };
  }

  /** Encode the on-chain call arguments for a prepared transaction. */
  static encodeArgs(proof: TransactionProof, ext: ExtData) {
    return [
      {
        a: proof.a,
        b: proof.b,
        c: proof.c,
        root: proof.root,
        publicAmount: proof.publicAmount,
        extDataHash: proof.extDataHash,
        inputNullifiers: proof.inputNullifiers,
        outputCommitments: proof.outputCommitments,
      },
      {
        recipient: ext.recipient,
        extAmount: ext.extAmount,
        relayer: ext.relayer,
        fee: ext.fee,
        encryptedOutput1: "0x" + bytesToHex(ext.encryptedOutput1),
        encryptedOutput2: "0x" + bytesToHex(ext.encryptedOutput2),
      },
    ] as const;
  }

  /** Prove and submit. `signer` pays gas (use a relayer for unlinkability). */
  async transact(p: TransactParams, signer: ethers.Signer): Promise<string> {
    const { proof, ext } = await this.prepare(p);
    const c = new ethers.Contract(this.address, SHIELDED_POOL_ABI, signer);
    const [args, extData] = UmbraShieldedClient.encodeArgs(proof, ext);
    const tx = await c.transact(args, extData, { value: ext.extAmount > 0n ? ext.extAmount : 0n });
    return (await tx.wait()).hash;
  }
}
