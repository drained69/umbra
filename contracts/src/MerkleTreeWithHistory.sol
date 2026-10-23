// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHasher} from "./interfaces/IHasher.sol";
import {PoseidonZeros} from "./PoseidonZeros.sol";

/// @title MerkleTreeWithHistory
/// @notice Fixed-height incremental Poseidon Merkle tree of note commitments with a rolling
///         window of recent roots (a proof against a slightly stale root still verifies).
///
/// @dev Storage-minimal for Portaldot, where every NEW storage slot locks ~3.84 tPOT
///      (pallet-revive depositPerByte = 0.06 tPOT). Everything a deposit touches is
///      allocated once at deployment, so depositors create ZERO new slots:
///        - empty-subtree hashes are compile-time constants (PoseidonZeros), not storage;
///        - filledSubtrees are initialised for every level;
///        - the root ring buffer is pre-filled with ROOT_SENTINEL (2^256-1), which can never
///          verify: isKnownRoot rejects values >= FIELD_SIZE, and both verifiers reject
///          non-canonical public inputs;
///        - nextIndex / currentRootIndex share a slot kept allocated by `_treeInit`.
abstract contract MerkleTreeWithHistory {
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// keccak256("umbra.v3.zero") % FIELD_SIZE  (== PoseidonZeros.zeros(0))
    uint256 public constant ZERO_VALUE =
        17003957365552116588566697242255183877916613397757664392656876041027752888120;
    uint32 public constant ROOT_HISTORY_SIZE = 12;
    uint256 private constant ROOT_SENTINEL = type(uint256).max;

    uint32 public immutable levels;
    IHasher public immutable hasher;

    mapping(uint256 => uint256) public filledSubtrees;
    mapping(uint256 => uint256) public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;
    uint8 private _treeInit; // keeps the packed index slot allocated (no deposit on first insert)

    error LevelsOutOfRange();
    error TreeIsFull();
    error LeafOutOfField();
    error HasherMismatch();

    constructor(uint32 _levels, IHasher _hasher) {
        if (_levels == 0 || _levels > PoseidonZeros.MAX_LEVELS) revert LevelsOutOfRange();
        // The zero hashes are Poseidon(2) constants: refuse any other hash function.
        if (_hasher.poseidon([zeros(0), zeros(0)]) != zeros(1)) revert HasherMismatch();
        levels = _levels;
        hasher = _hasher;

        for (uint32 i = 0; i < _levels; i++) {
            filledSubtrees[i] = zeros(i);
        }
        roots[0] = zeros(_levels);
        for (uint32 i = 1; i < ROOT_HISTORY_SIZE; i++) {
            roots[i] = ROOT_SENTINEL;
        }
        _treeInit = 1;
    }

    /// @notice Empty-subtree hash at `i` levels above the leaves.
    function zeros(uint256 i) public pure returns (uint256) {
        return PoseidonZeros.zeros(i);
    }

    function _insert(uint256 leaf) internal returns (uint32 index) {
        if (leaf >= FIELD_SIZE) revert LeafOutOfField();
        uint32 _nextIndex = nextIndex;
        if (_nextIndex == uint32(2) ** levels) revert TreeIsFull();

        uint32 currentIndex = _nextIndex;
        uint256 currentHash = leaf;
        uint256 left;
        uint256 right;
        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = zeros(i);
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = hasher.poseidon([left, right]);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    /// @notice Is `root` one of the last ROOT_HISTORY_SIZE roots?
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0 || root >= FIELD_SIZE) return false;
        uint32 i = currentRootIndex;
        do {
            if (root == roots[i]) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);
        return false;
    }

    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }
}
