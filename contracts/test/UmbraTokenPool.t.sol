// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraTokenPool} from "../src/UmbraTokenPool.sol";
import {UmbraPoolBase} from "../src/UmbraPoolBase.sol";
import {UmbraPoolFactory} from "../src/UmbraPoolFactory.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice ERC-20 shielded pool (e.g. pUSD via Portaldot's asset ERC-20 precompile).
contract UmbraTokenPoolTest is Test {
    uint256 constant DENOM = 100e6; // 100 pUSD (6 decimals)
    IHasher hasher;
    MockVerifier verifier;
    MockERC20 pusd;
    UmbraTokenPool pool;
    address alice = makeAddr("alice");

    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;

    function setUp() public {
        hasher = PoseidonDeployer.deploy(vm);
        verifier = new MockVerifier();
        pusd = new MockERC20("Portaldot USD", "pUSD", 6, 0);
        pool = new UmbraTokenPool(verifier, hasher, address(pusd), DENOM, 20);
        pusd.mint(alice, 1_000e6);
    }

    function _deposit(uint256 cmt) internal {
        vm.startPrank(alice);
        pusd.approve(address(pool), DENOM);
        pool.deposit(cmt, "");
        vm.stopPrank();
    }

    function test_DepositPullsExactTokens() public {
        _deposit(1);
        assertEq(pusd.balanceOf(address(pool)), DENOM);
        assertEq(pusd.balanceOf(alice), 900e6);
        assertEq(pool.token(), address(pusd));
    }

    function test_DepositRejectsNativeValue() public {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        pusd.approve(address(pool), DENOM);
        vm.expectRevert(UmbraTokenPool.NativeValueNotAccepted.selector);
        pool.deposit{value: 1}(2, "");
        vm.stopPrank();
    }

    function test_DepositWithoutApprovalReverts() public {
        vm.prank(alice);
        vm.expectRevert(UmbraTokenPool.TokenTransferFailed.selector);
        pool.deposit(3, "");
    }

    function test_WithdrawPaysRecipientAndRelayerInTokens() public {
        _deposit(4);
        address recipient = makeAddr("fresh");
        address relayer = makeAddr("relayer");
        uint256 fee = DENOM / 200; // 0.5%
        uint256 root = pool.getLastRoot();
        pool.withdraw(a, b, c, root, 99, payable(recipient), payable(relayer), fee, 0);
        assertEq(pusd.balanceOf(recipient), DENOM - fee);
        assertEq(pusd.balanceOf(relayer), fee);
        assertEq(pusd.balanceOf(address(pool)), 0);
        vm.expectRevert(UmbraPoolBase.NoteAlreadySpent.selector);
        pool.withdraw(a, b, c, root, 99, payable(recipient), payable(relayer), fee, 0);
    }

    function test_NoReturnValueTokenSupported() public {
        MockERC20 usdtLike = new MockERC20("USDT-like", "USDT", 6, 1);
        UmbraTokenPool p = new UmbraTokenPool(verifier, hasher, address(usdtLike), DENOM, 20);
        usdtLike.mint(alice, DENOM);
        vm.startPrank(alice);
        usdtLike.approve(address(p), DENOM);
        p.deposit(5, "");
        vm.stopPrank();
        address r = makeAddr("r");
        p.withdraw(a, b, c, p.getLastRoot(), 77, payable(r), payable(r), 0, 0);
        assertEq(usdtLike.balanceOf(r), DENOM);
    }

    function test_FeeOnTransferTokenRejected() public {
        MockERC20 feeTok = new MockERC20("Fee", "FEE", 18, 2);
        UmbraTokenPool p = new UmbraTokenPool(verifier, hasher, address(feeTok), 1 ether, 20);
        feeTok.mint(alice, 1 ether);
        vm.startPrank(alice);
        feeTok.approve(address(p), 1 ether);
        vm.expectRevert(UmbraTokenPool.UnsupportedToken.selector);
        p.deposit(6, "");
        vm.stopPrank();
    }

    function test_CodelessTokenRejectedAtDeposit() public {
        UmbraTokenPool p = new UmbraTokenPool(verifier, hasher, address(0x1234), DENOM, 20);
        vm.prank(alice);
        vm.expectRevert(UmbraTokenPool.TokenTransferFailed.selector);
        p.deposit(7, "");
    }

    function test_ZeroTokenRejected() public {
        vm.expectRevert(UmbraTokenPool.UnsupportedToken.selector);
        new UmbraTokenPool(verifier, hasher, address(0), DENOM, 20);
    }

    function test_FactoryCreatesNativeAndTokenPools() public {
        UmbraPoolFactory f = new UmbraPoolFactory(verifier, hasher, 20);
        address native1 = f.createPool(1 ether);
        address pusd100 = f.createPoolFor(address(pusd), DENOM);
        assertEq(f.poolForDenomination(1 ether), native1);
        assertEq(f.poolFor(address(pusd), DENOM), pusd100);
        assertEq(UmbraTokenPool(pusd100).token(), address(pusd));
        assertEq(f.allPools().length, 2);
        vm.expectRevert(UmbraPoolFactory.PoolExists.selector);
        f.createPoolFor(address(pusd), DENOM);
    }
}
