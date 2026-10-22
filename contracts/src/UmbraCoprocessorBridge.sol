// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraCoprocessorBridge
/// @notice THE headline Portaldot-only component: an IVerifier whose pairing check is
///         executed in the ink!/WASM contract `umbra_coprocessor`, not in the EVM.
///
/// @dev Why this exists: a Groth16 pairing check is ~hundreds of thousands of gas on an
///      EVM-only chain. Portaldot V3 runs a second VM (pallet-contracts / WASM) on the
///      SAME chain. We move the verify there (arkworks bn254, no EVM gas-loop ceiling)
///      and have the EVM asset layer call it. The pool is handed THIS contract as its
///      `verifier`, so neither the pool nor the user can tell the difference —
///      except in cost. That is the "right VM for the right job" story, made literal.
///
///      Two wiring options on V3 depending on what the runtime exposes:
///        1. A precompile / chain-extension address that the EVM can `staticcall`
///           to reach pallet-contracts. Set `coprocessor` to that address.
///        2. If direct cross-VM calls are unavailable on testnet, a trusted relayer
///           account calls the WASM contract, gets the boolean, and this bridge reads
///           the cached result keyed by the proof hash (set `attestor`).
///      Both paths are documented in docs/CROSS_VM.md; the pool interface is unchanged.
contract UmbraCoprocessorBridge is IVerifier {
    /// Address reachable from the EVM that forwards to the WASM coprocessor (precompile
    /// or chain-extension shim). address(0) => fall back to the attestation cache.
    address public immutable coprocessor;

    /// Optional trusted attestor that mirrors WASM verify results on-chain when direct
    /// cross-VM calls are not yet available on testnet.
    address public immutable attestor;

    mapping(bytes32 => bool) public attested;

    event Verified(bytes32 indexed proofHash, bool result, bool viaCoprocessor);
    event Attested(bytes32 indexed proofHash);

    error NotAttestor();

    constructor(address _coprocessor, address _attestor) {
        coprocessor = _coprocessor;
        attestor = _attestor;
    }

    /// @notice Attestor path: mirror a WASM-verified proof result on-chain.
    function attest(bytes32 proofHash) external {
        if (msg.sender != attestor) revert NotAttestor();
        attested[proofHash] = true;
        emit Attested(proofHash);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool) {
        bytes32 proofHash = keccak256(abi.encode(a, b, c, publicSignals));

        if (coprocessor != address(0)) {
            // Direct cross-VM path: staticcall the precompile/chain-extension that
            // forwards to the WASM coprocessor. ABI: verifyProof(bytes) -> bool.
            (bool ok, bytes memory out) =
                coprocessor.staticcall(abi.encodeWithSignature("verifyProof(bytes)", abi.encode(a, b, c, publicSignals)));
            if (ok && out.length == 32) {
                return abi.decode(out, (bool));
            }
        }
        // Attestation fallback (testnet): result mirrored by the WASM relayer.
        return attested[proofHash];
    }
}
