// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraBridgeInbox, IInboxPool} from "../src/UmbraBridgeInbox.sol";
import {UmbraTokenPool} from "../src/UmbraTokenPool.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract UmbraBridgeInboxTest is Test {
    uint256 constant SOURCE_CHAIN = 11155111;
    uint256 constant DENOM = 100e6;
    bytes32 constant SOURCE_SENDER = bytes32(uint256(uint160(address(0x1234))));

    MockERC20 token;
    UmbraTokenPool pool;
    UmbraBridgeInbox inbox;
    address messenger = makeAddr("authenticatedMessenger");

    function setUp() public {
        IHasher hasher = PoseidonDeployer.deploy(vm);
        token = new MockERC20("Bridge test USD", "btUSD", 6, 0);
        pool = new UmbraTokenPool(new MockVerifier(), hasher, address(token), DENOM, 20);
        inbox = new UmbraBridgeInbox(messenger, SOURCE_CHAIN, SOURCE_SENDER, address(token), IInboxPool(address(pool)));
        token.mint(messenger, 3 * DENOM);
        vm.prank(messenger);
        token.approve(address(inbox), 3 * DENOM);
    }

    function test_FinalizedBackedMessageCreatesShieldedNote() public {
        bytes32 id = inbox.messageId(7);
        vm.prank(messenger);
        inbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 7, 123, "encrypted");
        assertTrue(inbox.consumed(id));
        assertEq(token.balanceOf(address(pool)), DENOM);
        assertEq(token.balanceOf(address(inbox)), 0);
        assertEq(token.balanceOf(messenger), 2 * DENOM);
    }

    function test_ReplayRejectedEvenIfCommitmentChanges() public {
        vm.prank(messenger);
        inbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 7, 123, "");
        vm.prank(messenger);
        vm.expectRevert(UmbraBridgeInbox.MessageAlreadyUsed.selector);
        inbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 7, 456, "");
    }

    function test_OnlyAuthenticatedMessengerAndSource() public {
        vm.expectRevert(UmbraBridgeInbox.NotMessenger.selector);
        inbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 1, 123, "");
        vm.prank(messenger);
        vm.expectRevert(UmbraBridgeInbox.WrongSource.selector);
        inbox.deliver(1, SOURCE_SENDER, 1, 123, "");
        vm.prank(messenger);
        vm.expectRevert(UmbraBridgeInbox.WrongSource.selector);
        inbox.deliver(SOURCE_CHAIN, bytes32(uint256(999)), 1, 123, "");
    }

    function test_NoUnbackedNoteIfCollateralMissing() public {
        vm.prank(messenger);
        token.approve(address(inbox), 0);
        vm.prank(messenger);
        vm.expectRevert(UmbraBridgeInbox.TokenCallFailed.selector);
        inbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 9, 123, "");
        assertFalse(inbox.consumed(inbox.messageId(9)));
    }

    function test_FeeOnTransferCollateralRejected() public {
        MockERC20 feeToken = new MockERC20("Fee", "FEE", 6, 2);
        UmbraTokenPool feePool = new UmbraTokenPool(new MockVerifier(), PoseidonDeployer.deploy(vm), address(feeToken), DENOM, 20);
        UmbraBridgeInbox feeInbox = new UmbraBridgeInbox(messenger, SOURCE_CHAIN, SOURCE_SENDER, address(feeToken), IInboxPool(address(feePool)));
        feeToken.mint(messenger, DENOM);
        vm.prank(messenger);
        feeToken.approve(address(feeInbox), DENOM);
        vm.prank(messenger);
        vm.expectRevert(UmbraBridgeInbox.InvalidCollateral.selector);
        feeInbox.deliver(SOURCE_CHAIN, SOURCE_SENDER, 1, 123, "");
        assertEq(feeToken.balanceOf(address(feePool)), 0);
    }

    function test_InboxRejectsWrongPoolToken() public {
        MockERC20 other = new MockERC20("Other", "OTHER", 6, 0);
        vm.expectRevert(UmbraBridgeInbox.InvalidConfig.selector);
        new UmbraBridgeInbox(messenger, SOURCE_CHAIN, SOURCE_SENDER, address(other), IInboxPool(address(pool)));
    }
}
