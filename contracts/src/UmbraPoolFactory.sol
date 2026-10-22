// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UmbraPool} from "./UmbraPool.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraPoolFactory
/// @notice Deploys and registers one fixed-denomination UmbraPool per supported
///         denomination (e.g. 1, 10, 100 tPOT). Multi-denomination support lets users
///         shield arbitrary totals as a bundle of standard notes, maximizing each
///         denomination's anonymity set.
contract UmbraPoolFactory {
    IVerifier public immutable verifier;
    IHasher public immutable hasher;
    uint32 public immutable levels;

    mapping(uint256 => address) public poolForDenomination;
    uint256[] public denominations;

    event PoolCreated(uint256 indexed denomination, address pool);

    error PoolExists();

    constructor(IVerifier _verifier, IHasher _hasher, uint32 _levels) {
        verifier = _verifier;
        hasher = _hasher;
        levels = _levels;
    }

    function createPool(uint256 denomination) external returns (address pool) {
        if (poolForDenomination[denomination] != address(0)) revert PoolExists();
        pool = address(new UmbraPool(verifier, hasher, denomination, levels));
        poolForDenomination[denomination] = pool;
        denominations.push(denomination);
        emit PoolCreated(denomination, pool);
    }

    function allDenominations() external view returns (uint256[] memory) {
        return denominations;
    }
}
