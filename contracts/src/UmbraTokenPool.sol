// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UmbraPoolBase} from "./UmbraPoolBase.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraTokenPool
/// @notice Fixed-denomination shielded pool for an ERC-20 — including every Portaldot asset
///         (e.g. pUSD, asset 7777) through the runtime's pallet-assets ERC-20 precompile at
///         0x{assetId as 8 hex}000000000000000000000000 00010000. Shielding pUSD gives
///         confidential stablecoin payments with read-only viewing-key disclosure.
///
/// @dev Same circuit and verifier as the native pool (the withdraw proof is asset-agnostic).
///      Tokens with transfer fees / rebasing are rejected at deposit time by a balance-delta
///      check, so the pool can never become insolvent from a short-paying token.
contract UmbraTokenPool is UmbraPoolBase {
    address private immutable _token;

    error NativeValueNotAccepted();
    error TokenTransferFailed();
    error UnsupportedToken();

    constructor(IVerifier _verifier, IHasher _hasher, address token_, uint256 _denomination, uint32 _levels)
        UmbraPoolBase(_verifier, _hasher, _denomination, _levels)
    {
        // Asset precompiles have no EVM bytecode, so code-size checks can't be used here. A
        // codeless/non-ERC-20 address is still rejected at deposit: `balanceOf` returns no data.
        if (token_ == address(0)) revert UnsupportedToken();
        _token = token_;
    }

    function token() public view override returns (address) {
        return _token;
    }

    function _pullDeposit() internal override {
        if (msg.value != 0) revert NativeValueNotAccepted();
        uint256 before = _balance();
        _call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), denomination)); // transferFrom
        if (_balance() - before != denomination) revert UnsupportedToken(); // fee-on-transfer etc.
    }

    function _pushPayout(address to, uint256 amount) internal override {
        _call(abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
    }

    function _balance() private view returns (uint256) {
        (bool ok, bytes memory out) = _token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || out.length < 32) revert TokenTransferFailed();
        return abi.decode(out, (uint256));
    }

    /// @dev SafeERC20-style: succeed on empty return data or `true`.
    function _call(bytes memory data) private {
        (bool ok, bytes memory out) = _token.call(data);
        if (!ok || (out.length != 0 && (out.length < 32 || !abi.decode(out, (bool))))) revert TokenTransferFailed();
    }
}
