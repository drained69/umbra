// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHasher} from "./interfaces/IHasher.sol";

/// @title MerkleTreeWithHistory
/// @notice Fixed-height incremental Merkle tree of note commitments with a rolling
///         window of recent roots, so a proof built against a slightly-stale root
///         (another deposit landed meanwhile) still verifies. Poseidon-hashed.
/// @dev Adapted from the well-audited Tornado Cash design, ported to a pluggable
///      IHasher so the on-chain tree, the circom circuit and the SDK share one hash.
abstract contract MerkleTreeWithHistory {
    /// BN254 scalar field order. Every commitment / leaf must be strictly below this.
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// "Nothing-up-my-sleeve" zero leaf = keccak256("umbra.v3.zero") % FIELD_SIZE.
    uint256 public constant ZERO_VALUE =
        17003957365552116588566697242255183877916613397757664392656876041027752888120;

    uint32 public immutable levels;
    IHasher public immutable hasher;

    // Number of historical roots kept for proof freshness.
    uint32 public constant ROOT_HISTORY_SIZE = 30;

    mapping(uint256 => uint256) public filledSubtrees; // level => last-filled subtree hash
    mapping(uint256 => uint256) public roots; // slot => root
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    error LevelsOutOfRange();
    error TreeIsFull();
    error LeafOutOfField();

    constructor(uint32 _levels, IHasher _hasher) {
        if (_levels == 0 || _levels >= 32) revert LevelsOutOfRange();
        levels = _levels;
        hasher = _hasher;

        for (uint32 i = 0; i < _levels; i++) {
            filledSubtrees[i] = _zeros(i);
        }
        roots[0] = _zeros(_levels);
    }

    /// @notice Insert a leaf and return its index.
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
                right = _zeros(i);
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

    /// @notice Is `root` any of the last ROOT_HISTORY_SIZE roots?
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
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

    /// @notice Precomputed subtree-of-zeros for each level (the "empty" hashes).
    /// @dev Computed lazily from ZERO_VALUE via the injected hasher; cheap because
    ///      it is only ever read during insert at the frontier.
    mapping(uint256 => uint256) private _zeroCache;
    bool private _zerosInit;

    function _zeros(uint32 i) internal returns (uint256) {
        if (!_zerosInit) {
            uint256 cur = ZERO_VALUE;
            _zeroCache[0] = cur;
            for (uint32 l = 1; l <= levels; l++) {
                cur = hasher.poseidon([cur, cur]);
                _zeroCache[l] = cur;
            }
            _zerosInit = true;
        }
        return _zeroCache[i];
    }
}
