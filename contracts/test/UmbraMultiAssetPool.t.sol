// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraMultiAssetPool} from "../src/UmbraMultiAssetPool.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Multi-asset pool state machine: per-asset deposits and payouts, and the private
///         swap leg (counterparty must be the recipient and deliver the bought asset in the
///         same call). Stand-in verifier; ZK soundness is covered by the circuit tests.
contract UmbraMultiAssetPoolTest is Test {
    UmbraMultiAssetPool pool;
    MockVerifier verifier;
    MockERC20 token;
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 constant NATIVE = 0;
    uint256 constant TOKEN = 1;

    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256 nn;
    address relayer = makeAddr("relayer");

    function setUp() public {
        IHasher hasher = PoseidonDeployer.deploy(vm);
        verifier = new MockVerifier();
        token = new MockERC20("pUSD", "pUSD", 6, 0);
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        pool = new UmbraMultiAssetPool(verifier, hasher, 20, tokens);
    }

    function _fe(string memory tag) internal returns (uint256) {
        nn++;
        return uint256(keccak256(abi.encode(tag, nn))) % FIELD;
    }

    function _ext(address recipient, int256 extAmount, address rel, uint256 fee)
        internal
        pure
        returns (UmbraMultiAssetPool.ExtData memory)
    {
        return UmbraMultiAssetPool.ExtData(recipient, extAmount, rel, fee, "", "");
    }

    function _proof(UmbraMultiAssetPool.ExtData memory ext, uint256 asset, uint256 swapAsset, uint256 swapAmount)
        internal
        returns (UmbraMultiAssetPool.Proof memory p)
    {
        p.a = a;
        p.b = b;
        p.c = c;
        p.root = pool.getLastRoot();
        p.publicAmount = pool.calculatePublicAmount(ext.extAmount, ext.fee);
        p.extDataHash = uint256(keccak256(abi.encode(ext))) % FIELD;
        p.publicAsset = asset;
        p.swapAsset = swapAsset;
        p.swapAmount = swapAmount;
        p.inputNullifiers = [_fe("n0"), _fe("n1")];
        p.outputCommitments = [_fe("c0"), _fe("c1")];
    }

    function _depositNative(uint256 amount) internal {
        UmbraMultiAssetPool.ExtData memory e = _ext(address(0), int256(amount), address(0), 0);
        vm.deal(address(this), amount);
        pool.transact{value: amount}(_proof(e, NATIVE, 0, 0), e);
    }

    function _depositToken(uint256 amount) internal {
        token.mint(address(this), amount);
        token.approve(address(pool), amount);
        UmbraMultiAssetPool.ExtData memory e = _ext(address(0), int256(amount), address(0), 0);
        pool.transact(_proof(e, TOKEN, 0, 0), e);
    }

    function test_AssetsAreFixedAtDeployment() public view {
        assertEq(pool.assetCount(), 2);
        assertEq(pool.assetAddress(NATIVE), address(0));
        assertEq(pool.assetAddress(TOKEN), address(token));
    }

    function test_DepositsAndWithdrawalsPerAsset() public {
        _depositNative(100);
        _depositToken(500);
        assertEq(address(pool).balance, 100);
        assertEq(token.balanceOf(address(pool)), 500);

        address to = makeAddr("to");
        UmbraMultiAssetPool.ExtData memory w = _ext(to, -200, relayer, 5);
        pool.transact(_proof(w, TOKEN, 0, 0), w);
        assertEq(token.balanceOf(to), 200);
        assertEq(token.balanceOf(relayer), 5, "fee is paid in the transaction's asset");
        assertEq(address(pool).balance, 100, "native balance untouched");
    }

    function test_TokenDepositRejectsNativeValue() public {
        token.mint(address(this), 10);
        token.approve(address(pool), 10);
        UmbraMultiAssetPool.ExtData memory e = _ext(address(0), 10, address(0), 0);
        UmbraMultiAssetPool.Proof memory p = _proof(e, TOKEN, 0, 0);
        vm.deal(address(this), 1);
        vm.expectRevert(UmbraMultiAssetPool.InvalidDepositValue.selector);
        pool.transact{value: 1}(p, e);
    }

    function test_SwapNativeForToken() public {
        _depositNative(100);
        token.mint(relayer, 70);
        vm.prank(relayer);
        token.approve(address(pool), 70);

        // trader's notes pay 40 + fee 2 native; relayer delivers 70 token into a new note
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -40, relayer, 2);
        UmbraMultiAssetPool.Proof memory p = _proof(e, NATIVE, TOKEN, 70);
        vm.prank(relayer);
        pool.transact(p, e);
        assertEq(relayer.balance, 42);
        assertEq(token.balanceOf(address(pool)), 70);
        assertEq(token.balanceOf(relayer), 0);
        assertEq(address(pool).balance, 58);
        assertEq(pool.nextIndex(), 4);
    }

    function test_SwapTokenForNative() public {
        _depositToken(1000);
        vm.deal(relayer, 30);
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -300, relayer, 10);
        UmbraMultiAssetPool.Proof memory p = _proof(e, TOKEN, NATIVE, 30);
        vm.prank(relayer);
        pool.transact{value: 30}(p, e);
        assertEq(token.balanceOf(relayer), 310);
        assertEq(address(pool).balance, 30);
    }

    function test_SwapOnlyByTheNamedCounterparty() public {
        _depositNative(100);
        address other = makeAddr("other");
        token.mint(other, 70);
        vm.prank(other);
        token.approve(address(pool), 70);
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -40, relayer, 0);
        UmbraMultiAssetPool.Proof memory p = _proof(e, NATIVE, TOKEN, 70);
        vm.prank(other);
        vm.expectRevert(UmbraMultiAssetPool.NotSwapCounterparty.selector);
        pool.transact(p, e);
    }

    function test_SwapRevertsWithoutDelivery() public {
        _depositNative(100);
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -40, relayer, 0);
        UmbraMultiAssetPool.Proof memory p = _proof(e, NATIVE, TOKEN, 70);
        vm.prank(relayer); // no tokens, no approval
        vm.expectRevert(UmbraMultiAssetPool.TokenTransferFailed.selector);
        pool.transact(p, e);
        assertFalse(pool.isSpent(p.inputNullifiers[0]), "the trader's notes stay unspent");
    }

    function test_NativeDeliveryMustMatch() public {
        _depositToken(1000);
        vm.deal(relayer, 30);
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -300, relayer, 0);
        UmbraMultiAssetPool.Proof memory p = _proof(e, TOKEN, NATIVE, 30);
        vm.prank(relayer);
        vm.expectRevert(UmbraMultiAssetPool.InvalidDepositValue.selector);
        pool.transact{value: 29}(p, e);
    }

    function test_SwapShapeRules() public {
        _depositNative(100);
        // same asset on both legs
        UmbraMultiAssetPool.ExtData memory e = _ext(relayer, -40, relayer, 0);
        UmbraMultiAssetPool.Proof memory p = _proof(e, NATIVE, NATIVE, 70);
        vm.prank(relayer);
        vm.expectRevert(UmbraMultiAssetPool.InvalidSwap.selector);
        pool.transact(p, e);
        // a swap must pay its counterparty
        e = _ext(relayer, 0, relayer, 0);
        p = _proof(e, NATIVE, TOKEN, 70);
        vm.prank(relayer);
        vm.expectRevert(UmbraMultiAssetPool.InvalidSwap.selector);
        pool.transact(p, e);
        // no stray swapAsset on a plain transaction
        e = _ext(address(0), 0, address(0), 0);
        p = _proof(e, NATIVE, TOKEN, 0);
        vm.expectRevert(UmbraMultiAssetPool.InvalidSwap.selector);
        pool.transact(p, e);
        // unknown assets
        p = _proof(e, 2, 0, 0);
        vm.expectRevert(UmbraMultiAssetPool.UnknownAsset.selector);
        pool.transact(p, e);
    }

    function test_DoubleSpendAndBindingChecks() public {
        _depositNative(100);
        UmbraMultiAssetPool.ExtData memory w = _ext(makeAddr("to"), -10, address(0), 0);
        UmbraMultiAssetPool.Proof memory p = _proof(w, NATIVE, 0, 0);
        pool.transact(p, w);
        vm.expectRevert(UmbraMultiAssetPool.NoteAlreadySpent.selector);
        pool.transact(p, w);

        UmbraMultiAssetPool.Proof memory q = _proof(w, NATIVE, 0, 0);
        w.recipient = makeAddr("thief");
        vm.expectRevert(UmbraMultiAssetPool.ExtDataHashMismatch.selector);
        pool.transact(q, w);

        verifier.setShouldVerify(false);
        UmbraMultiAssetPool.ExtData memory w2 = _ext(makeAddr("to"), -10, address(0), 0);
        UmbraMultiAssetPool.Proof memory r = _proof(w2, NATIVE, 0, 0);
        vm.expectRevert(UmbraMultiAssetPool.InvalidProof.selector);
        pool.transact(r, w2);
    }

    function test_ConstructorRejectsBadAssetLists() public {
        address[] memory dup = new address[](2);
        dup[0] = address(token);
        dup[1] = address(token);
        IHasher hasher = PoseidonDeployer.deploy(vm);
        vm.expectRevert(UmbraMultiAssetPool.InvalidConfig.selector);
        new UmbraMultiAssetPool(verifier, hasher, 20, dup);
    }

    receive() external payable {}
}
