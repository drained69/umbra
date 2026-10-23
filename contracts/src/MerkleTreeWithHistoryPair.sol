// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHasher} from "./interfaces/IHasher.sol";
import {PoseidonZeros} from "./PoseidonZeros.sol";

/// @title MerkleTreeWithHistoryPair
/// @notice Incremental Poseidon Merkle tree inserting TWO leaves per call (the join-split
///         creates 2 outputs per transaction), with a rolling window of recent roots.
/// @dev Same Portaldot storage-minimal layout as MerkleTreeWithHistory: constant zero
///      hashes, pre-initialised filledSubtrees and root ring buffer, so transactions create
///      no new tree slots (only their two nullifier slots).
abstract contract MerkleTreeWithHistoryPair {
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
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
    uint8 private _treeInit;

    error LevelsOutOfRange();
    error TreeIsFull();
    error LeafOutOfField();
    error HasherMismatch();

    constructor(uint32 _levels, IHasher _hasher) {
        if (_levels < 2 || _levels > PoseidonZeros.MAX_LEVELS) revert LevelsOutOfRange();
        if (_hasher.poseidon([zeros(0), zeros(0)]) != zeros(1)) revert HasherMismatch();
        levels = _levels;
        hasher = _hasher;
        for (uint32 i = 1; i < _levels; i++) {
            filledSubtrees[i] = zeros(i);
        }
        roots[0] = zeros(_levels);
        for (uint32 i = 1; i < ROOT_HISTORY_SIZE; i++) {
            roots[i] = ROOT_SENTINEL;
        }
        _treeInit = 1;
    }

    function zeros(uint256 i) public pure returns (uint256) {
        return PoseidonZeros.zeros(i);
    }

    /// @notice Insert two leaves as a bottom-level pair; returns the index of the first.
    function _insert(uint256 leaf1, uint256 leaf2) internal returns (uint32 index) {
        if (leaf1 >= FIELD_SIZE || leaf2 >= FIELD_SIZE) revert LeafOutOfField();
        uint32 _nextIndex = nextIndex;
        if (_nextIndex == uint32(2) ** levels) revert TreeIsFull();

        uint32 currentIndex = _nextIndex >> 1;
        uint256 currentLevelHash = hasher.poseidon([leaf1, leaf2]);
        uint256 left;
        uint256 right;
        for (uint32 i = 1; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros(i);
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hasher.poseidon([left, right]);
            currentIndex >>= 1;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 2;
        return _nextIndex;
    }

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
