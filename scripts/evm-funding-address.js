#!/usr/bin/env node
/*
 * Where do I send native tPOT so my EVM (0x) address can spend it?
 *
 * The hackathon faucet pays a native SS58 address (5...). Portaldot V3's EVM layer
 * (pallet-revive) backs each 0x address with the native account  H160 ++ 0xEE * 12.
 * Transfer tPOT (e.g. in polkadot.js / node-console) from your 5... account to the SS58
 * address this prints, and it shows up as the 0x address's EVM balance.
 *
 *   node scripts/evm-funding-address.js 0xYourDeployerAddress
 *   node scripts/evm-funding-address.js            # uses PRIVATE_KEY from .env
 */
import "dotenv/config";
import { ethers } from "ethers";
import { blake2b } from "@noble/hashes/blake2b";

const SS58_PREFIX = 42; // Portaldot (system_properties.ss58Format)

export function ss58Encode(accountId32, prefix = SS58_PREFIX) {
  const body = new Uint8Array([prefix, ...accountId32]);
  const hash = blake2b(new Uint8Array([...new TextEncoder().encode("SS58PRE"), ...body]), { dkLen: 64 });
  return ethers.encodeBase58(new Uint8Array([...body, hash[0], hash[1]]));
}

export function evmToNative(evmAddress) {
  return ss58Encode(ethers.getBytes(ethers.concat([ethers.getAddress(evmAddress), "0x" + "ee".repeat(12)])));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // self-check against the well-known //Alice vector
  const alice = ethers.getBytes("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d");
  if (ss58Encode(alice) !== "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY") throw new Error("SS58 self-check failed");

  const addr = process.argv[2] || (process.env.PRIVATE_KEY ? new ethers.Wallet(process.env.PRIVATE_KEY).address : null);
  if (!addr || !ethers.isAddress(addr)) {
    console.error("usage: node scripts/evm-funding-address.js <0x address>   (or set PRIVATE_KEY)");
    process.exit(1);
  }
  console.log(`EVM address      : ${ethers.getAddress(addr)}`);
  console.log(`Send native tPOT : ${evmToNative(addr)}`);
}
