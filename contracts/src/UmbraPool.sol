// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UmbraPoolBase} from "./UmbraPoolBase.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraPool
/// @notice Fixed-denomination shielded pool for native tPOT on Portaldot V3.
///         `denomination` is in 18-decimal EVM wei: pallet-revive scales native 14-dec POT
///         by 10^4 (runtime constant `revive.nativeToEthRatio`). Callable both from EVM
///         wallets and directly from native Portaldot accounts via `revive.call`.
contract UmbraPool is UmbraPoolBase {
    constructor(IVerifier _verifier, IHasher _hasher, uint256 _denomination, uint32 _levels)
        UmbraPoolBase(_verifier, _hasher, _denomination, _levels)
    {}

    function token() public pure override returns (address) {
        return address(0);
    }

    function _pullDeposit() internal override {
        if (msg.value != denomination) revert InvalidDenomination();
    }

    function _pushPayout(address to, uint256 amount) internal override {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }
}
