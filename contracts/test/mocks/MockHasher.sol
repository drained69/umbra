// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHasher} from "../../src/interfaces/IHasher.sol";

/// @notice Test-only stand-in for Poseidon. Uses keccak256 reduced into the BN254 field.
///         Lets us exercise the pool's Merkle/nullifier state machine without needing the
///         real Poseidon library in-process. Production uses the canonical PoseidonT3.
contract MockHasher is IHasher {
    uint256 constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function poseidon(uint256[2] calldata input) external pure returns (uint256) {
        return uint256(keccak256(abi.encode(input[0], input[1]))) % FIELD_SIZE;
    }
}
