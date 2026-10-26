#!/usr/bin/env node
/** One-shot Sepolia → Portaldot operator bridge prototype. Dry-run unless --send. */
import { ethers } from "ethers";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const sourceAbi = [
  "function operator() view returns (address)",
  "function token() view returns (address)",
  "function destinationChainId() view returns (uint256)",
  "function destinationInbox() view returns (address)",
  "function denomination() view returns (uint256)",
  "function locks(uint256) view returns (address depositor,uint256 commitment,uint64 createdAt,uint8 state)",
  "function settle(uint256 nonce)",
  "event Locked(uint256 indexed nonce,address indexed depositor,uint256 indexed commitment,uint256 sourceChainId,uint256 destinationChainId,address destinationInbox,address sourceToken,uint256 amount,bytes encryptedMemo)",
];
const inboxAbi = [
  "function messenger() view returns (address)",
  "function sourceChainId() view returns (uint256)",
  "function sourceSender() view returns (bytes32)",
  "function token() view returns (address)",
  "function denomination() view returns (uint256)",
  "function consumed(bytes32) view returns (bool)",
  "function messageId(uint256 nonce) view returns (bytes32)",
  "function deliver(uint256 chainId,bytes32 sender,uint256 nonce,uint256 commitment,bytes encryptedMemo)",
  "event BridgeNoteCredited(bytes32 indexed messageId,uint256 indexed commitment,uint256 sourceNonce)",
];
const tokenAbi = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)"];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: BRIDGE_SOURCE=0x… BRIDGE_INBOX=0x… BRIDGE_SOURCE_TOKEN=0x… BRIDGE_DEST_TOKEN=0x… SEPOLIA_RPC=https://… PORTALDOT_RPC=https://… node scripts/bridge-relay.js --nonce N [--send]\n--send requires BRIDGE_OPERATOR_KEY. The operator must already hold destination collateral and gas on both chains.");
    return;
  }
  const index = process.argv.indexOf("--nonce");
  if (index < 0 || !/^\d+$/.test(process.argv[index + 1] || "")) throw new Error("--nonce N is required");
  const nonce = BigInt(process.argv[index + 1]);
  const send = process.argv.includes("--send");
  const sourceAddress = ethers.getAddress(required("BRIDGE_SOURCE"));
  const inboxAddress = ethers.getAddress(required("BRIDGE_INBOX"));
  const sourceProvider = new ethers.JsonRpcProvider(required("SEPOLIA_RPC"));
  const destProvider = new ethers.JsonRpcProvider(required("PORTALDOT_RPC"));
  const [sourceNetwork, destNetwork] = await Promise.all([sourceProvider.getNetwork(), destProvider.getNetwork()]);
  if (sourceNetwork.chainId !== 11155111n || destNetwork.chainId !== 420420777n) throw new Error("wrong source or destination chain ID");

  const source = new ethers.Contract(sourceAddress, sourceAbi, sourceProvider);
  const inbox = new ethers.Contract(inboxAddress, inboxAbi, destProvider);
  const [operator, sourceToken, destinationChainId, destinationInbox, sourceDenom, messenger, sourceChainId, sourceSender, destToken, destDenom, lock] = await Promise.all([
    source.operator(), source.token(), source.destinationChainId(), source.destinationInbox(), source.denomination(),
    inbox.messenger(), inbox.sourceChainId(), inbox.sourceSender(), inbox.token(), inbox.denomination(), source.locks(nonce),
  ]);
  if (destinationChainId !== 420420777n || sourceChainId !== 11155111n || destinationInbox.toLowerCase() !== inboxAddress.toLowerCase()) throw new Error("route configuration mismatch");
  if (sourceSender.toLowerCase() !== ethers.zeroPadValue(sourceAddress, 32).toLowerCase()) throw new Error("inbox source contract mismatch");
  if (sourceDenom !== destDenom) throw new Error("source and destination denominations differ; no conversion is configured");
  if (operator.toLowerCase() !== messenger.toLowerCase()) throw new Error("operator and inbox messenger differ");
  if (lock.state !== 1n) throw new Error("source lock is not pending");
  if (sourceToken.toLowerCase() !== ethers.getAddress(required("BRIDGE_SOURCE_TOKEN")).toLowerCase() || destToken.toLowerCase() !== ethers.getAddress(required("BRIDGE_DEST_TOKEN")).toLowerCase()) throw new Error("token mapping does not match the configured allowlist");
  const sourceAsset = new ethers.Contract(sourceToken, tokenAbi, sourceProvider);
  const token = new ethers.Contract(destToken, tokenAbi, destProvider);
  const [sourceDecimals, destDecimals] = await Promise.all([sourceAsset.decimals(), token.decimals()]);
  if (sourceDecimals !== destDecimals) throw new Error("token decimals differ; no conversion is configured");

  const fromBlock = Number(process.env.BRIDGE_SOURCE_FROM_BLOCK || 0);
  const logs = await source.queryFilter(source.filters.Locked(nonce), fromBlock, "latest");
  if (logs.length !== 1) throw new Error(`expected exactly one source Locked event, found ${logs.length}`);
  const event = logs[0];
  const sourceHead = await sourceProvider.getBlockNumber();
  const confirmations = sourceHead - event.blockNumber + 1;
  const requiredConfirmations = Number(process.env.BRIDGE_SOURCE_CONFIRMATIONS || 12);
  if (confirmations < requiredConfirmations) throw new Error(`source has ${confirmations}/${requiredConfirmations} confirmations`);
  if (
    event.args.commitment !== lock.commitment ||
    event.args.depositor.toLowerCase() !== lock.depositor.toLowerCase() ||
    event.args.amount !== sourceDenom ||
    event.args.sourceChainId !== 11155111n ||
    event.args.destinationChainId !== 420420777n ||
    event.args.destinationInbox.toLowerCase() !== inboxAddress.toLowerCase() ||
    event.args.sourceToken.toLowerCase() !== sourceToken.toLowerCase()
  ) throw new Error("source event and lock state mismatch");

  const id = await inbox.messageId(nonce);
  const alreadyDelivered = await inbox.consumed(id);
  const collateral = await token.balanceOf(operator);
  console.log(JSON.stringify({ sourceChainId: 11155111, destinationChainId: 420420777, nonce: nonce.toString(), sourceTx: event.transactionHash, confirmations, sourceToken, destinationToken: destToken, amount: destDenom.toString(), commitment: lock.commitment.toString(), operator, alreadyDelivered, operatorCollateral: collateral.toString(), mode: send ? "send" : "dry-run" }, null, 2));
  if (!send) return;
  const signer = new ethers.Wallet(required("BRIDGE_OPERATOR_KEY"), destProvider);
  if (signer.address.toLowerCase() !== operator.toLowerCase()) throw new Error("BRIDGE_OPERATOR_KEY does not match configured operator");
  const inboxWriter = inbox.connect(signer);
  if (!alreadyDelivered) {
    if (collateral < destDenom) throw new Error("operator has insufficient destination collateral");
    const allowance = await token.allowance(operator, inboxAddress);
    if (allowance < destDenom) {
      const approval = await token.connect(signer).approve(inboxAddress, destDenom);
      await approval.wait();
      console.log(`destination approval: ${approval.hash}`);
    }
    await inboxWriter.deliver.staticCall(11155111n, sourceSender, nonce, lock.commitment, event.args.encryptedMemo);
    const delivery = await inboxWriter.deliver(11155111n, sourceSender, nonce, lock.commitment, event.args.encryptedMemo);
    await delivery.wait(Number(process.env.BRIDGE_DEST_CONFIRMATIONS || 3));
    console.log(`destination credit: ${delivery.hash}`);
  }
  const creditLogs = await inbox.queryFilter(inbox.filters.BridgeNoteCredited(id), Number(process.env.BRIDGE_DEST_FROM_BLOCK || 0), "latest");
  if (creditLogs.length !== 1 || creditLogs[0].args.commitment !== lock.commitment || creditLogs[0].args.sourceNonce !== nonce) throw new Error("destination credit event not verified; source collateral remains locked");
  const destHead = await destProvider.getBlockNumber();
  const destConfirmations = destHead - creditLogs[0].blockNumber + 1;
  const requiredDestConfirmations = Number(process.env.BRIDGE_DEST_CONFIRMATIONS || 3);
  if (destConfirmations < requiredDestConfirmations) throw new Error(`destination has ${destConfirmations}/${requiredDestConfirmations} confirmations; source collateral remains locked`);
  const sourceSigner = new ethers.Wallet(required("BRIDGE_OPERATOR_KEY"), sourceProvider);
  const settlement = await source.connect(sourceSigner).settle(nonce);
  await settlement.wait();
  console.log(`source settlement: ${settlement.hash}`);
}

main().catch((error) => { console.error(error?.shortMessage || error?.message || String(error)); process.exitCode = 1; });
