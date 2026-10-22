/*
 * Cross-VM attestation (CROSS_VM.md, Path B): verify the Groth16 proof INSIDE Portaldot's
 * WASM VM (the ink! `umbra_coprocessor`), then mirror the result onto the EVM bridge.
 *
 * Proofs are passed in the EVM calldata encoding (32-byte big-endian words) — the same bytes
 * the Solidity verifier would see — so nothing is re-serialized between VMs (audit H-02).
 *
 * Enabled by CROSS_VM=1 with:
 *   PORTALDOT_WS=wss://test-node-v3.portaldot.dev
 *   COPROCESSOR_CONTRACT=<ink! contract SS58 address for the withdraw circuit>
 *   COPROCESSOR_METADATA=coprocessor/target/ink/umbra_coprocessor/umbra_coprocessor.json
 *   SUBSTRATE_SEED=<attestor seed>   (testnet only; never a funded mainnet key)
 * and deployment.verifierMode === "coprocessor" (pool verifier is UmbraCoprocessorBridge).
 *
 * Fails CLOSED: if CROSS_VM=1 and the WASM verification can't run or returns false, the
 * withdrawal is NOT submitted.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const BRIDGE_ABI = [
  "function attest(bytes32 proofHash)",
  "function attested(bytes32) view returns (bool)",
  "function proofHashOf(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256[] publicSignals) view returns (bytes32)",
];

const word = (x) => ethers.zeroPadValue(ethers.toBeHex(BigInt(x)), 32);

let apiPromise = null;
async function contract() {
  const { ApiPromise, WsProvider, Keyring } = await import("@polkadot/api");
  const { ContractPromise } = await import("@polkadot/api-contract");
  if (!apiPromise) apiPromise = ApiPromise.create({ provider: new WsProvider(process.env.PORTALDOT_WS) });
  const api = await apiPromise;
  const metadata = JSON.parse(readFileSync(process.env.COPROCESSOR_METADATA, "utf8"));
  const signer = new Keyring({ type: "sr25519" }).addFromUri(process.env.SUBSTRATE_SEED);
  return { api, c: new ContractPromise(api, metadata, process.env.COPROCESSOR_CONTRACT), signer };
}

export function crossVmEnabled() {
  return process.env.CROSS_VM === "1";
}

/**
 * @returns {{ attested: boolean, proofHash?: string }}
 * @throws if cross-VM is enabled and verification fails or is unavailable (fail closed)
 */
export async function crossVmAttest({ a, b, c, publicSignals, bridgeAddress, evmWallet }) {
  if (!crossVmEnabled()) return { attested: false };

  const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, evmWallet);
  const proofHash = await bridge.proofHashOf(a, b, c, publicSignals); // domain-separated (M-01)
  if (await bridge.attested(proofHash)) return { attested: true, proofHash };

  const { api, c: coproc, signer } = await contract();
  const gasLimit = api.registry.createType("WeightV2", { refTime: 100_000_000_000n, proofSize: 2_000_000n });
  const args = [
    [word(a[0]), word(a[1])],
    [word(b[0][0]), word(b[0][1]), word(b[1][0]), word(b[1][1])], // EVM order, unchanged
    [word(c[0]), word(c[1])],
    publicSignals.map(word),
  ];
  const { result, output } = await coproc.query.check(signer.address, { gasLimit, storageDepositLimit: null }, ...args);
  if (result.isErr) throw new Error(`WASM coprocessor call failed: ${result.asErr.toString()}`);
  const verdict = output?.toJSON?.();
  const ok = verdict?.ok === true || verdict?.ok?.ok === true;
  if (!ok) throw new Error(`WASM coprocessor rejected the proof: ${JSON.stringify(verdict)}`);

  await (await bridge.attest(proofHash)).wait();
  return { attested: true, proofHash };
}
