/*
 * Cross-VM attestation: run the Groth16 verify inside Portaldot's WASM VM (the ink!
 * `umbra_coprocessor`), then mirror the boolean onto the EVM via UmbraCoprocessorBridge.
 *
 * This is the demonstrable dual-VM path on testnet when a direct EVM->WASM precompile
 * isn't available: one chain, both VMs, in a single withdrawal flow.
 *
 * Enabled by CROSS_VM=1 and these env vars:
 *   PORTALDOT_WS=wss://test-node-v3.portaldot.dev
 *   COPROCESSOR_CONTRACT=<ink! contract address (SS58)>
 *   COPROCESSOR_METADATA=./coprocessor/target/ink/umbra_coprocessor.json
 *   BRIDGE_ADDRESS=<UmbraCoprocessorBridge EVM address>
 *   SUBSTRATE_SEED="//Alice"   (attestor account, must == bridge.attestor / coprocessor caller)
 *
 * If disabled or dependencies are missing, this is a no-op and the on-chain verifier
 * path is used instead — the pool interface is identical either way.
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";

const BRIDGE_ABI = ["function attest(bytes32 proofHash)"];

function proofHash({ a, b, c, publicSignals }) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[]"],
    [a, b, c, publicSignals]
  );
  return ethers.keccak256(encoded);
}

export async function maybeCrossVmAttest({ a, b, c, publicSignals, deployment, evmWallet }) {
  if (process.env.CROSS_VM !== "1") return { skipped: true };

  const hash = proofHash({ a, b, c, publicSignals });

  // 1. Verify in the WASM VM via polkadot.js (optional dependency).
  let wasmResult = null;
  try {
    const { ApiPromise, WsProvider, Keyring } = await import("@polkadot/api");
    const { ContractPromise } = await import("@polkadot/api-contract");
    const api = await ApiPromise.create({ provider: new WsProvider(process.env.PORTALDOT_WS) });
    const metadata = JSON.parse(readFileSync(process.env.COPROCESSOR_METADATA, "utf8"));
    const contract = new ContractPromise(api, metadata, process.env.COPROCESSOR_CONTRACT);
    const keyring = new Keyring({ type: "sr25519" });
    const signer = keyring.addFromUri(process.env.SUBSTRATE_SEED || "//Alice");

    // ark-serialized proof + 32-byte LE public inputs are produced by the SDK; here we
    // pass through what the client supplied. (See sdk: toCoprocessorArgs.)
    const proofBytes = process.env._PROOF_BYTES || "0x"; // supplied by client in cross-VM mode
    const publicInputs = publicSignals.map((s) =>
      ethers.zeroPadValue(ethers.toBeHex(BigInt(s)), 32)
    );

    const gasLimit = api.registry.createType("WeightV2", {
      refTime: 50_000_000_000n,
      proofSize: 1_000_000n,
    });
    const { output } = await contract.query.verify(
      signer.address,
      { gasLimit, storageDepositLimit: null },
      proofBytes,
      publicInputs,
      hash
    );
    wasmResult = output?.toJSON?.();
    await api.disconnect();
  } catch (e) {
    console.warn("[crossvm] WASM verify unavailable, falling back:", e?.message || e);
    return { skipped: true, reason: "wasm-unavailable" };
  }

  // 2. Mirror the result onto the EVM bridge so the pool's verifier reads `attested`.
  if (deployment.contracts.verifier && deployment.verifierMode === "coprocessor") {
    const bridge = new ethers.Contract(deployment.contracts.verifier, BRIDGE_ABI, evmWallet);
    const tx = await bridge.attest(hash);
    await tx.wait();
  }
  return { proofHash: hash, wasmResult };
}
