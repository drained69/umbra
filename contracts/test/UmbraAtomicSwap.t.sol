// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraAtomicSwap, IAtomicSwapPool} from "../src/UmbraAtomicSwap.sol";
import {UmbraPool} from "../src/UmbraPool.sol";
import {UmbraTokenPool} from "../src/UmbraTokenPool.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SwapSignalVerifier is IVerifier {
    address public expectedRecipient;
    address public expectedRelayer;
    bool public enabled = true;

    function configure(address recipient, address relayer) external {
        expectedRecipient = recipient;
        expectedRelayer = relayer;
    }

    function setEnabled(bool value) external { enabled = value; }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata signals)
        external view returns (bool)
    {
        return enabled && signals.length == 6 && signals[2] == uint256(uint160(expectedRecipient))
            && signals[3] == uint256(uint160(expectedRelayer)) && signals[4] == 0 && signals[5] == 0;
    }
}

contract UmbraAtomicSwapTest is Test {
    uint256 constant NATIVE = 10 ether;
    uint256 constant TOKEN = 100e6;
    uint256 constant NATIVE_KEY = 0xA11CE;
    uint256 constant TOKEN_KEY = 0xB0B;

    UmbraPool nativePool;
    UmbraTokenPool tokenPool;
    UmbraAtomicSwap swapper;
    MockERC20 token;
    SwapSignalVerifier nativeVerifier;
    SwapSignalVerifier tokenVerifier;

    function setUp() public {
        IHasher hasher = PoseidonDeployer.deploy(vm);
        nativeVerifier = new SwapSignalVerifier();
        tokenVerifier = new SwapSignalVerifier();
        token = new MockERC20("Test pUSDT", "pUSDT", 6, 0);
        nativePool = new UmbraPool(nativeVerifier, hasher, NATIVE, 20);
        tokenPool = new UmbraTokenPool(tokenVerifier, hasher, address(token), TOKEN, 20);
        swapper = new UmbraAtomicSwap(IAtomicSwapPool(address(nativePool)), IAtomicSwapPool(address(tokenPool)));
        vm.deal(address(this), NATIVE);
        nativePool.deposit{value: NATIVE}(101, "initial native note");
        token.mint(address(this), TOKEN);
        token.approve(address(tokenPool), TOKEN);
        tokenPool.deposit(202, "initial token note");
    }

    function _order() internal view returns (UmbraAtomicSwap.Order memory order) {
        order.swapId = bytes32(uint256(7));
        order.deadline = uint64(block.timestamp + 1 hours);
        order.nativeProof.root = nativePool.getLastRoot();
        order.nativeProof.nullifierHash = 301;
        order.tokenProof.root = tokenPool.getLastRoot();
        order.tokenProof.nullifierHash = 302;
        order.nativeOutput = 401;
        order.tokenOutput = 402;
        order.nativeMemo = "new native note";
        order.tokenMemo = "new token note";
        order.nativeSigner = vm.addr(NATIVE_KEY);
        order.tokenSigner = vm.addr(TOKEN_KEY);
    }

    function _sign(UmbraAtomicSwap.Order memory order) internal view returns (bytes memory nativeSig, bytes memory tokenSig) {
        bytes32 digest = swapper.orderDigest(order);
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        nativeSig = _signOne(NATIVE_KEY, ethDigest);
        tokenSig = _signOne(TOKEN_KEY, ethDigest);
    }

    function _signOne(uint256 key, bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _configure(UmbraAtomicSwap.Order memory order) internal {
        address tag = address(uint160(uint256(swapper.orderDigest(order))));
        nativeVerifier.configure(address(swapper), tag);
        tokenVerifier.configure(address(swapper), tag);
    }

    function test_AtomicSwapReplacesBothNotesWithoutChangingPoolCollateral() public {
        UmbraAtomicSwap.Order memory order = _order();
        _configure(order);
        (bytes memory nativeSig, bytes memory tokenSig) = _sign(order);
        swapper.swap(order, nativeSig, tokenSig);
        assertTrue(nativePool.isSpent(301));
        assertTrue(tokenPool.isSpent(302));
        assertEq(nativePool.nextIndex(), 2);
        assertEq(tokenPool.nextIndex(), 2);
        assertEq(address(nativePool).balance, NATIVE);
        assertEq(token.balanceOf(address(tokenPool)), TOKEN);
        assertEq(address(swapper).balance, 0);
        assertEq(token.balanceOf(address(swapper)), 0);
        assertTrue(swapper.usedSwapId(order.swapId));
    }

    function test_BadSignatureCannotSpendEitherNote() public {
        UmbraAtomicSwap.Order memory order = _order();
        _configure(order);
        (bytes memory nativeSig,) = _sign(order);
        vm.expectRevert(UmbraAtomicSwap.InvalidSignature.selector);
        swapper.swap(order, nativeSig, nativeSig);
        assertFalse(nativePool.isSpent(301));
        assertFalse(tokenPool.isSpent(302));
    }

    function test_SecondInvalidProofRollsBackFirstWithdrawal() public {
        UmbraAtomicSwap.Order memory order = _order();
        _configure(order);
        tokenVerifier.setEnabled(false);
        (bytes memory nativeSig, bytes memory tokenSig) = _sign(order);
        vm.expectRevert();
        swapper.swap(order, nativeSig, tokenSig);
        assertFalse(nativePool.isSpent(301));
        assertFalse(tokenPool.isSpent(302));
        assertEq(address(nativePool).balance, NATIVE);
        assertEq(token.balanceOf(address(tokenPool)), TOKEN);
        assertFalse(swapper.usedSwapId(order.swapId));
    }

    function test_ChangedOutputIsRejectedByProofBinding() public {
        UmbraAtomicSwap.Order memory order = _order();
        _configure(order);
        order.tokenOutput = 999;
        (bytes memory nativeSig, bytes memory tokenSig) = _sign(order);
        vm.expectRevert();
        swapper.swap(order, nativeSig, tokenSig);
        assertFalse(nativePool.isSpent(301));
    }

    function test_ExpiredOrderCannotSpend() public {
        UmbraAtomicSwap.Order memory order = _order();
        _configure(order);
        (bytes memory nativeSig, bytes memory tokenSig) = _sign(order);
        vm.warp(order.deadline + 1);
        vm.expectRevert(UmbraAtomicSwap.Expired.selector);
        swapper.swap(order, nativeSig, tokenSig);
    }

    receive() external payable {}
}
