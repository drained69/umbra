// Client for UmbraMultiAssetPool: one private balance holding several assets (id 0 = native
// tPOT, then ERC-20s such as pUSD), with private payments, withdrawals and relayer-backed
// private swaps. Notes commit to their asset: Poseidon(amount, publicKey, blinding, asset).

import { ethers } from "ethers";
import { bytesToHex } from "@noble/hashes/utils";
import { Keypair } from "./keypair";
import { Utxo } from "./utxo";
import { buildTransaction, type ExtData, type TransactionProof } from "./transaction";
import type { ProvingArtifacts } from "./prover";
import { EXISTENTIAL_DEPOSIT_WEI } from "./units";
import { UmbraShieldedClient, type RelayTerms } from "./shieldedClient";

export const MULTI_ASSET_POOL_ABI = [
  "function transact((uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 publicAmount,uint256 extDataHash,uint256 publicAsset,uint256 swapAsset,uint256 swapAmount,uint256[2] inputNullifiers,uint256[2] outputCommitments) args,(address recipient,int256 extAmount,address relayer,uint256 fee,bytes encryptedOutput1,bytes encryptedOutput2) extData) payable",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function getLastRoot() view returns (uint256)",
  "function nextIndex() view returns (uint32)",
  "function assetCount() view returns (uint256)",
  "function assetAddress(uint256 id) view returns (address)",
  "event NewCommitment(uint256 indexed commitment, uint256 index, bytes encryptedOutput)",
  "event NewNullifier(uint256 indexed nullifier)",
];

export const NATIVE_ASSET = 0n;

/** A transaction on one asset; `swap` mints output 1 as a note of another asset. */
export interface MultiAssetPlan {
  asset: bigint;
  inputs: Utxo[]; // 0..2 of the owner's notes of `asset`
  outputs: Utxo[]; // 0..2; for a swap exactly [change, bought]
  owner: Keypair;
  extAmount?: bigint; // >0 deposit, <0 withdrawal or swap payout, 0 transfer
  recipient?: string; // withdrawal recipient, or the swap counterparty
  relayer?: string;
  fee?: bigint; // in `asset` units
  swap?: { asset: bigint; amount: bigint };
}

export interface PreparedMultiAsset {
  proof: TransactionProof;
  ext: ExtData;
}

export class UmbraMultiAssetClient {
  readonly address: string;
  private scanner: UmbraShieldedClient; // same events, isSpent and roots
  private contract: ethers.Contract;
  private runner: ethers.ContractRunner;

  constructor(address: string, runner: ethers.ContractRunner, opts: { deployBlock?: number; chunkSize?: number } = {}) {
    this.address = address;
    this.runner = runner;
    this.scanner = new UmbraShieldedClient(address, runner, opts);
    this.contract = new ethers.Contract(address, MULTI_ASSET_POOL_ABI, runner);
  }

  private get provider(): ethers.Provider {
    return ((this.runner as any).provider ?? this.runner) as ethers.Provider;
  }

  scanCommitments() {
    return this.scanner.scanCommitments();
  }

  /** Every note addressed to `owner` in this pool (all assets), with its spent flag. */
  async myNotes(owner: Keypair): Promise<{ utxo: Utxo; spent: boolean }[]> {
    return (await this.scanner.myNotes(owner)).filter((n) => n.utxo.asset !== undefined);
  }

  /** Unspent notes of one asset. */
  async unspent(owner: Keypair, asset: bigint): Promise<Utxo[]> {
    return (await this.myNotes(owner)).filter((n) => !n.spent && n.utxo.asset === asset).map((n) => n.utxo);
  }

  /** asset id -> unspent total */
  static balances(notes: { utxo: Utxo; spent: boolean }[]): Map<bigint, bigint> {
    const out = new Map<bigint, bigint>();
    for (const n of notes) if (!n.spent) out.set(n.utxo.asset!, (out.get(n.utxo.asset!) ?? 0n) + n.utxo.amount);
    return out;
  }

  /** Largest amount of `asset` one transaction can spend (two notes). */
  static spendable(notes: { utxo: Utxo; spent: boolean }[], asset: bigint): bigint {
    return UmbraShieldedClient.spendable(notes.filter((n) => !n.spent && n.utxo.asset === asset).map((n) => n.utxo));
  }

  planDeposit(owner: Keypair, asset: bigint, amount: bigint, to?: string, memo?: string): MultiAssetPlan {
    if (amount <= 0n) throw new Error("amount must be positive");
    const keypair = to ? Keypair.fromAddress(to) : owner;
    return { asset, inputs: [], outputs: [new Utxo({ amount, keypair, asset, memo })], owner, extAmount: amount };
  }

  async planPayment(p: { owner: Keypair; to: string; asset: bigint; amount: bigint; memo?: string; relay?: RelayTerms }): Promise<MultiAssetPlan> {
    if (p.amount <= 0n) throw new Error("amount must be positive");
    const fee = p.relay?.fee ?? 0n;
    const { inputs, change } = this.select(await this.unspent(p.owner, p.asset), p.amount + fee);
    const outputs = [new Utxo({ amount: p.amount, keypair: Keypair.fromAddress(p.to), asset: p.asset, memo: p.memo })];
    if (change > 0n) outputs.push(new Utxo({ amount: change, keypair: p.owner, asset: p.asset }));
    return { asset: p.asset, inputs, outputs, owner: p.owner, extAmount: 0n, relayer: p.relay?.relayer, fee };
  }

  async planWithdrawal(owner: Keypair, asset: bigint, amount: bigint, recipient: string, relay?: RelayTerms): Promise<MultiAssetPlan> {
    if (amount <= 0n) throw new Error("amount must be positive");
    const fee = relay?.fee ?? 0n;
    const { inputs, change } = this.select(await this.unspent(owner, asset), amount + fee);
    const outputs = change > 0n ? [new Utxo({ amount: change, keypair: owner, asset })] : [];
    return { asset, inputs, outputs, owner, extAmount: -amount, recipient, relayer: relay?.relayer, fee };
  }

  /**
   * Plan a private swap: spend `amountIn` (+ the relayer fee) of `sell` from the private
   * balance and receive a new note of exactly `amountOut` of `buy`. The relayer is the
   * counterparty: the pool pays it `amountIn` + fee only if it delivers `amountOut` in the
   * same call, so the trader's wallet never appears.
   */
  async planSwap(p: { owner: Keypair; sell: bigint; buy: bigint; amountIn: bigint; amountOut: bigint; relay: RelayTerms; memo?: string }): Promise<MultiAssetPlan> {
    if (p.sell === p.buy) throw new Error("sell and buy must be different assets");
    if (p.amountIn <= 0n || p.amountOut <= 0n) throw new Error("amounts must be positive");
    const { inputs, change } = this.select(await this.unspent(p.owner, p.sell), p.amountIn + p.relay.fee);
    const outputs = [
      new Utxo({ amount: change, keypair: p.owner, asset: p.sell }),
      new Utxo({ amount: p.amountOut, keypair: p.owner, asset: p.buy, memo: p.memo }),
    ];
    return {
      asset: p.sell,
      inputs,
      outputs,
      owner: p.owner,
      extAmount: -p.amountIn,
      recipient: p.relay.relayer,
      relayer: p.relay.relayer,
      fee: p.relay.fee,
      swap: { asset: p.buy, amount: p.amountOut },
    };
  }

  private select(notes: Utxo[], amount: bigint): { inputs: Utxo[]; change: bigint } {
    const inputs = [...notes].sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1)).slice(0, 2);
    const total = inputs.reduce((s, u) => s + u.amount, 0n);
    if (total < amount) {
      const all = notes.reduce((s, u) => s + u.amount, 0n);
      throw new Error(
        all >= amount
          ? "your private balance of this asset is split across more than two notes and one transaction can spend two — send yourself a smaller amount first to merge notes"
          : "insufficient private balance"
      );
    }
    return { inputs, change: total - amount };
  }

  /** Build + prove (does not send). */
  async prepare(p: MultiAssetPlan, artifacts: ProvingArtifacts): Promise<PreparedMultiAsset> {
    const asset = p.asset;
    const extAmount = p.extAmount ?? 0n;
    const fee = p.fee ?? 0n;
    const recipient = p.recipient ?? ethers.ZeroAddress;
    const relayer = p.relayer ?? ethers.ZeroAddress;
    if (p.inputs.length > 2 || p.outputs.length > 2) throw new Error("max 2 inputs and 2 outputs");
    for (const u of p.inputs) {
      if (!u.keypair.canSpend) throw new Error("input note is not spendable by this keypair");
      if (u.asset !== asset) throw new Error("every input must be the transaction's asset");
    }
    const swap = p.swap;
    if (swap) {
      if (p.outputs.length !== 2 || p.outputs[0].asset !== asset || p.outputs[1].asset !== swap.asset || p.outputs[1].amount !== swap.amount) {
        throw new Error("a swap needs outputs [change, bought note]");
      }
      if (extAmount >= 0n || recipient === ethers.ZeroAddress) throw new Error("a swap pays its counterparty");
    } else if (p.outputs.some((u) => u.asset !== asset)) {
      throw new Error("every output must be the transaction's asset");
    }
    const inputs = [...p.inputs];
    while (inputs.length < 2) inputs.push(new Utxo({ amount: 0n, keypair: new Keypair(), asset }));
    const outputs = [...p.outputs];
    while (outputs.length < 2) outputs.push(new Utxo({ amount: 0n, keypair: p.owner, asset }));

    const sumIn = inputs.reduce((s, u) => s + u.amount, 0n);
    const sumOut = outputs[0].amount + (swap ? 0n : outputs[1].amount);
    if (sumIn + extAmount - fee !== sumOut) {
      throw new Error(`value not conserved: in ${sumIn} + ext ${extAmount} - fee ${fee} != out ${sumOut}`);
    }
    if (extAmount < 0n && !swap) {
      if (recipient === ethers.ZeroAddress) throw new Error("withdrawal needs a recipient");
      const funded = (await this.provider.getBalance(recipient)) > 0n;
      if (asset === NATIVE_ASSET && -extAmount < EXISTENTIAL_DEPOSIT_WEI && !funded) {
        throw new Error("withdrawal below the 0.1 tPOT existential deposit to a brand-new address");
      }
      if (asset !== NATIVE_ASSET && !funded) {
        throw new Error("the recipient needs a little tPOT first: Portaldot accounts can't hold this token without it");
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
    const proof = await buildTransaction([inputs[0], inputs[1]], [outputs[0], outputs[1]], leaves, ext, artifacts, {
      publicAsset: asset,
      swapAsset: swap?.asset ?? 0n,
      swapAmount: swap?.amount ?? 0n,
    });
    if (!(await this.contract.isKnownRoot(proof.root))) {
      throw new Error("locally rebuilt root not known on-chain — refusing to submit");
    }
    return { proof, ext };
  }

  /** Encode the on-chain call arguments for a prepared transaction. */
  static encodeArgs(proof: TransactionProof, ext: ExtData) {
    if (!proof.multi) throw new Error("not a multi-asset proof");
    return [
      {
        a: proof.a,
        b: proof.b,
        c: proof.c,
        root: proof.root,
        publicAmount: proof.publicAmount,
        extDataHash: proof.extDataHash,
        publicAsset: proof.multi.publicAsset,
        swapAsset: proof.multi.swapAsset,
        swapAmount: proof.multi.swapAmount,
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

  /** Native value a submitter must attach: a native deposit, or a native swap delivery. */
  static valueFor(proof: TransactionProof, ext: ExtData): bigint {
    let v = 0n;
    if (ext.extAmount > 0n && proof.multi!.publicAsset === NATIVE_ASSET) v += ext.extAmount;
    if (proof.multi!.swapAmount > 0n && proof.multi!.swapAsset === NATIVE_ASSET) v += proof.multi!.swapAmount;
    return v;
  }

  /** Prove and submit with `signer` (deposits; use a relayer for spends). Approves ERC-20s first. */
  async transact(p: MultiAssetPlan, artifacts: ProvingArtifacts, signer: ethers.Signer): Promise<string> {
    const { proof, ext } = await this.prepare(p, artifacts);
    if (ext.extAmount > 0n && p.asset !== NATIVE_ASSET) {
      const token = new ethers.Contract(await this.contract.assetAddress(p.asset), ["function approve(address,uint256) returns (bool)"], signer);
      await (await token.approve(this.address, ext.extAmount)).wait();
    }
    const c = new ethers.Contract(this.address, MULTI_ASSET_POOL_ABI, signer);
    const [args, extData] = UmbraMultiAssetClient.encodeArgs(proof, ext);
    const tx = await c.transact(args, extData, { value: UmbraMultiAssetClient.valueFor(proof, ext) });
    return (await tx.wait()).hash;
  }
}
