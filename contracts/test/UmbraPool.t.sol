// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraPool} from "../src/UmbraPool.sol";
import {UmbraPoolFactory} from "../src/UmbraPoolFactory.sol";
import {MockHasher} from "./mocks/MockHasher.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice Exercises the pool's privacy state machine (Merkle insert, root history,
///         nullifier double-spend prevention, relayer fee split, proof gating) with
///         stand-in hash/verifier. The ZK soundness itself is covered by the circuit
///         tests + the on-chain/WASM Groth16 verifier; this proves the EVM asset layer.
contract UmbraPoolTest is Test {
    UmbraPool pool;
    MockHasher hasher;
    MockVerifier verifier;

    uint256 constant DENOM = 10 ether; // 10 tPOT: EVM layer uses 18-decimal units
    uint32 constant LEVELS = 20;

    // dummy Groth16 points; MockVerifier ignores them
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;

    function setUp() public {
        hasher = new MockHasher();
        verifier = new MockVerifier();
        pool = new UmbraPool(verifier, hasher, DENOM, LEVELS);
    }

    function _commitment(uint256 seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("cmt", seed)))
            % 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    }

    function test_DepositRequiresExactDenomination() public {
        uint256 cmt = _commitment(1);
        vm.deal(address(this), 100 ether);
        vm.expectRevert(UmbraPool.InvalidDenomination.selector);
        pool.deposit{value: 9 ether}(cmt, "");
    }

    function test_DepositInsertsAndUpdatesRoot() public {
        uint256 rootBefore = pool.getLastRoot();
        uint256 cmt = _commitment(2);
        vm.deal(address(this), DENOM);
        pool.deposit{value: DENOM}(cmt, "");
        assertTrue(pool.commitments(cmt));
        assertTrue(pool.getLastRoot() != rootBefore, "root must change");
        assertTrue(pool.isKnownRoot(pool.getLastRoot()));
    }

    function test_DepositRejectsDuplicateCommitment() public {
        uint256 cmt = _commitment(3);
        vm.deal(address(this), DENOM * 2);
        pool.deposit{value: DENOM}(cmt, "");
        vm.expectRevert(UmbraPool.CommitmentExists.selector);
        pool.deposit{value: DENOM}(cmt, "");
    }

    function test_WithdrawHappyPathPaysRecipient() public {
        _deposit(_commitment(10));
        uint256 root = pool.getLastRoot();
        address payable recipient = payable(makeAddr("freshRecipient"));
        uint256 nh = _commitment(99);

        pool.withdraw(a, b, c, root, nh, recipient, recipient, 0, 0);

        assertEq(recipient.balance, DENOM, "recipient gets full denomination");
        assertTrue(pool.isSpent(nh), "nullifier marked spent");
    }

    function test_WithdrawRelayerFeeSplit() public {
        _deposit(_commitment(11));
        uint256 root = pool.getLastRoot();
        address payable recipient = payable(makeAddr("recipient"));
        address payable relayer = payable(makeAddr("relayer"));
        uint256 nh = _commitment(98);
        uint256 fee = 1 ether;

        pool.withdraw(a, b, c, root, nh, recipient, relayer, fee, 0);

        assertEq(recipient.balance, DENOM - fee, "recipient gets denomination minus fee");
        assertEq(relayer.balance, fee, "relayer paid fee");
    }

    function test_WithdrawRejectsDoubleSpend() public {
        _deposit(_commitment(12));
        uint256 root = pool.getLastRoot();
        address payable recipient = payable(makeAddr("r2"));
        uint256 nh = _commitment(97);

        pool.withdraw(a, b, c, root, nh, recipient, recipient, 0, 0);
        vm.expectRevert(UmbraPool.NoteAlreadySpent.selector);
        pool.withdraw(a, b, c, root, nh, recipient, recipient, 0, 0);
    }

    function test_WithdrawRejectsUnknownRoot() public {
        _deposit(_commitment(13));
        address payable recipient = payable(makeAddr("r3"));
        vm.expectRevert(UmbraPool.UnknownRoot.selector);
        pool.withdraw(a, b, c, uint256(0xdead), _commitment(96), recipient, recipient, 0, 0);
    }

    function test_WithdrawRejectsBadProof() public {
        _deposit(_commitment(14));
        uint256 root = pool.getLastRoot();
        address payable recipient = payable(makeAddr("r4"));
        verifier.setShouldVerify(false);
        vm.expectRevert(UmbraPool.InvalidProof.selector);
        pool.withdraw(a, b, c, root, _commitment(95), recipient, recipient, 0, 0);
    }

    function test_WithdrawRejectsFeeTooHigh() public {
        _deposit(_commitment(15));
        uint256 root = pool.getLastRoot();
        address payable recipient = payable(makeAddr("r5"));
        vm.expectRevert(UmbraPool.FeeExceedsDenomination.selector);
        pool.withdraw(a, b, c, root, _commitment(94), recipient, recipient, DENOM + 1, 0);
    }

    function test_RootHistoryToleratesInterleavedDeposits() public {
        _deposit(_commitment(20));
        uint256 rootAtProofTime = pool.getLastRoot();
        // more deposits land before the withdrawal is mined
        _deposit(_commitment(21));
        _deposit(_commitment(22));
        // the older root is still accepted thanks to the rolling history window
        assertTrue(pool.isKnownRoot(rootAtProofTime));
        address payable recipient = payable(makeAddr("r6"));
        pool.withdraw(a, b, c, rootAtProofTime, _commitment(93), recipient, recipient, 0, 0);
        assertEq(recipient.balance, DENOM);
    }

    function _deposit(uint256 cmt) internal {
        vm.deal(address(this), DENOM);
        pool.deposit{value: DENOM}(cmt, "");
    }

    receive() external payable {}
}

contract UmbraPoolFactoryTest is Test {
    function test_FactoryCreatesAndRegistersPools() public {
        MockHasher hasher = new MockHasher();
        MockVerifier verifier = new MockVerifier();
        UmbraPoolFactory factory = new UmbraPoolFactory(verifier, hasher, 20);

        address p1 = factory.createPool(1 ether);
        address p10 = factory.createPool(10 ether);

        assertEq(factory.poolForDenomination(1 ether), p1);
        assertEq(factory.poolForDenomination(10 ether), p10);
        assertEq(factory.allDenominations().length, 2);

        vm.expectRevert(UmbraPoolFactory.PoolExists.selector);
        factory.createPool(1 ether);
    }
}
