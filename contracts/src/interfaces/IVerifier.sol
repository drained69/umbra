// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IVerifier
/// @notice Groth16 verifier interface matching the snarkjs Solidity export shape.
/// @dev On Portaldot V3 the heavy pairing check can run EITHER:
///        (a) on-chain in this Solidity verifier (snarkjs `Verifier.sol`), OR
///        (b) in the ink!/WASM `umbra_coprocessor` contract (arkworks Groth16),
///            which the pool calls cross-VM. See docs/ARCHITECTURE.md.
///      Both expose this identical interface so the pool is VM-agnostic.
interface IVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool);
}
