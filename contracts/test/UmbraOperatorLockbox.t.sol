// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraOperatorLockbox} from "../src/UmbraOperatorLockbox.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract UmbraOperatorLockboxTest is Test {
    uint256 constant DENOM = 100e6;
    uint256 constant OPERATOR_KEY = 0xabc123;
    address operator = vm.addr(OPERATOR_KEY);
    address alice = makeAddr("alice");
    address inbox = makeAddr("destinationInbox");
    MockERC20 token;
    UmbraOperatorLockbox lockbox;

    function setUp() public {
        token = new MockERC20("Sepolia test USD", "stUSD", 6, 0);
        lockbox = new UmbraOperatorLockbox(address(token), operator, 420420777, DENOM, 1 days);
        vm.prank(operator);
        lockbox.configureDestination(inbox);
        token.mint(alice, 2 * DENOM);
        vm.prank(alice);
        token.approve(address(lockbox), 2 * DENOM);
    }

    function _lock(uint256 commitment) internal returns (uint256 nonce) {
        vm.prank(alice);
        nonce = lockbox.lock(commitment, "encrypted");
    }

    function _refundSignature(uint256 nonce) internal returns (bytes memory) {
        bytes32 digest = lockbox.refundDigest(nonce);
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OPERATOR_KEY, signed);
        return abi.encodePacked(r, s, v);
    }

    function test_LockAndOperatorSettlement() public {
        uint256 nonce = _lock(123);
        assertEq(nonce, 1);
        assertEq(token.balanceOf(address(lockbox)), DENOM);
        vm.prank(operator);
        lockbox.settle(nonce);
        assertEq(token.balanceOf(operator), DENOM);
        bytes memory signature = _refundSignature(nonce);
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.WrongState.selector);
        lockbox.refund(nonce, signature);
    }

    function test_RefundRequiresDelayAndOperatorCertificate() public {
        uint256 nonce = _lock(123);
        bytes memory signature = _refundSignature(nonce);
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.TooEarly.selector);
        lockbox.refund(nonce, signature);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        lockbox.refund(nonce, signature);
        assertEq(token.balanceOf(alice), 2 * DENOM);
        vm.prank(operator);
        vm.expectRevert(UmbraOperatorLockbox.WrongState.selector);
        lockbox.settle(nonce);
    }

    function test_OnlyOwnerCanRefundAndSignatureCannotCrossLocks() public {
        uint256 first = _lock(123);
        uint256 second = _lock(456);
        vm.warp(block.timestamp + 1 days);
        bytes memory signature = _refundSignature(first);
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(UmbraOperatorLockbox.NotDepositor.selector);
        lockbox.refund(first, signature);
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.InvalidRefundSignature.selector);
        lockbox.refund(second, signature);
    }

    function test_OnlyOperatorCanSettle() public {
        uint256 nonce = _lock(123);
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.NotOperator.selector);
        lockbox.settle(nonce);
    }

    function test_RouteMustBeSetOnceBeforeLocking() public {
        UmbraOperatorLockbox fresh = new UmbraOperatorLockbox(address(token), operator, 420420777, DENOM, 1 days);
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.InvalidConfig.selector);
        fresh.lock(123, "");
        vm.prank(alice);
        vm.expectRevert(UmbraOperatorLockbox.NotOperator.selector);
        fresh.configureDestination(inbox);
        vm.prank(operator);
        fresh.configureDestination(inbox);
        vm.prank(operator);
        vm.expectRevert(UmbraOperatorLockbox.InvalidConfig.selector);
        fresh.configureDestination(inbox);
    }

    function test_FeeOnTransferTokenCannotBackMessage() public {
        MockERC20 feeToken = new MockERC20("Fee", "FEE", 6, 2);
        UmbraOperatorLockbox bad = new UmbraOperatorLockbox(address(feeToken), operator, 420420777, DENOM, 1 days);
        vm.prank(operator);
        bad.configureDestination(inbox);
        feeToken.mint(alice, DENOM);
        vm.startPrank(alice);
        feeToken.approve(address(bad), DENOM);
        vm.expectRevert(UmbraOperatorLockbox.InvalidCollateral.selector);
        bad.lock(123, "");
        vm.stopPrank();
        assertEq(bad.nextNonce(), 0);
    }
}
