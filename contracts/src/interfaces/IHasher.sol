// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IHasher
/// @notice Poseidon(T3) hash over the BN254 scalar field: hash of two field elements.
/// @dev The SAME hash must be used by:
///        - this pool's Merkle tree (on-chain),
///        - the circom circuit (in-SNARK, via circomlib Poseidon(2)),
///        - the client SDK (poseidon-lite).
///      On Portaldot V3 testnet the concrete implementation is the canonical
///      `poseidon-solidity` PoseidonT3 library, deployed by `script/DeployPoseidon.s.sol`.
///      In unit tests a keccak-based `MockHasher` stands in for the pool state-machine checks.
interface IHasher {
    /// @param input two field elements, each < SNARK_SCALAR_FIELD
    /// @return the Poseidon hash, a single field element < SNARK_SCALAR_FIELD
    function poseidon(uint256[2] calldata input) external pure returns (uint256);
}
