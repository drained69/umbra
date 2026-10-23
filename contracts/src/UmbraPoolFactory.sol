// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UmbraPool} from "./UmbraPool.sol";
import {UmbraTokenPool} from "./UmbraTokenPool.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraPoolFactory
/// @notice Deploys and registers fixed-denomination pools: one per (asset, denomination).
///         asset == address(0) is native tPOT; any other address is an ERC-20 — including
///         Portaldot assets via their ERC-20 precompile (see UmbraTokenPool). Standard
///         denominations concentrate each anonymity set. Permissionless and immutable:
///         anyone can open a pool, no one can change or remove one.
contract UmbraPoolFactory {
    IVerifier public immutable verifier;
    IHasher public immutable hasher;
    uint32 public immutable levels;

    /// asset => denomination => pool
    mapping(address => mapping(uint256 => address)) public poolFor;
    address[] public pools;

    event PoolCreated(address indexed asset, uint256 indexed denomination, address pool);

    error PoolExists();

    constructor(IVerifier _verifier, IHasher _hasher, uint32 _levels) {
        verifier = _verifier;
        hasher = _hasher;
        levels = _levels;
    }

    /// @notice Native tPOT pool (back-compat helper).
    function createPool(uint256 denomination) external returns (address) {
        return createPoolFor(address(0), denomination);
    }

    function createPoolFor(address asset, uint256 denomination) public returns (address pool) {
        if (poolFor[asset][denomination] != address(0)) revert PoolExists();
        pool = asset == address(0)
            ? address(new UmbraPool(verifier, hasher, denomination, levels))
            : address(new UmbraTokenPool(verifier, hasher, asset, denomination, levels));
        poolFor[asset][denomination] = pool;
        pools.push(pool);
        emit PoolCreated(asset, denomination, pool);
    }

    /// @notice Native pool lookup (back-compat).
    function poolForDenomination(uint256 denomination) external view returns (address) {
        return poolFor[address(0)][denomination];
    }

    function allPools() external view returns (address[] memory) {
        return pools;
    }
}
