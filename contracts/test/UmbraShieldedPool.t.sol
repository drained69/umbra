// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraShieldedPool} from "../src/UmbraShieldedPool.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice Join-split pool state machine: deposit / withdraw / transfer, double-spend,
///         root freshness, extDataHash + publicAmount binding, relayer fee. Uses stand-in
///         hash/verifier; ZK soundness is covered by the circuit + TransactionVerifier test.
contract UmbraShieldedPoolTest is Test {
    UmbraShieldedPool pool;
    IHasher hasher;
    MockVerifier verifier;
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
    uint256 nn; // nullifier/commitment nonce

    function setUp() public {
        hasher = PoseidonDeployer.deploy(vm);
        verifier = new MockVerifier();
        pool = new UmbraShieldedPool(verifier, hasher, 20);
    }

    function _fe(string memory tag) internal returns (uint256) {
        nn++;
        return uint256(keccak256(abi.encode(tag, nn))) % FIELD;
    }

    function _ext(address recipient, int256 extAmount, address relayer, uint256 fee)
        internal
        pure
        returns (UmbraShieldedPool.ExtData memory)
    {
        return UmbraShieldedPool.ExtData(recipient, extAmount, relayer, fee, "", "");
    }

    function _proof(UmbraShieldedPool.ExtData memory ext, uint256 root)
        internal
        returns (UmbraShieldedPool.Proof memory p)
    {
        p.a = a;
        p.b = b;
        p.c = c;
        p.root = root;
        p.publicAmount = pool.calculatePublicAmount(ext.extAmount, ext.fee);
        p.extDataHash = uint256(keccak256(abi.encode(ext))) % FIELD;
        p.inputNullifiers = [_fe("n0"), _fe("n1")];
        p.outputCommitments = [_fe("c0"), _fe("c1")];
    }

    function test_Deposit() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 100, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        vm.deal(address(this), 100);
        pool.transact{value: 100}(p, ext);
        assertEq(address(pool).balance, 100);
        assertTrue(pool.isSpent(p.inputNullifiers[0]));
        assertEq(pool.nextIndex(), 2);
    }

    function test_WithdrawPaysRecipient() public {
        // fund the pool
        UmbraShieldedPool.ExtData memory dep = _ext(address(0), 100, address(0), 0);
        UmbraShieldedPool.Proof memory pd = _proof(dep, pool.getLastRoot());
        vm.deal(address(this), 100);
        pool.transact{value: 100}(pd, dep);

        address payable recipient = payable(makeAddr("recipient"));
        UmbraShieldedPool.ExtData memory w = _ext(recipient, -40, address(0), 0);
        UmbraShieldedPool.Proof memory pw = _proof(w, pool.getLastRoot());
        pool.transact(pw, w);

        assertEq(recipient.balance, 40);
        assertEq(address(pool).balance, 60);
    }

    function test_InternalTransferNoValue() public {
        UmbraShieldedPool.ExtData memory t = _ext(address(0), 0, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(t, pool.getLastRoot());
        pool.transact(p, t); // no value in/out; just rotates notes
        assertEq(pool.nextIndex(), 2);
    }

    function test_DepositWithRelayerFee() public {
        address payable relayer = payable(makeAddr("relayer"));
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 100, relayer, 5);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        vm.deal(address(this), 100);
        pool.transact{value: 100}(p, ext);
        assertEq(relayer.balance, 5);
        assertEq(address(pool).balance, 95);
    }

    function test_RejectsDoubleSpend() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 0, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        pool.transact(p, ext);
        // replay same nullifiers
        UmbraShieldedPool.Proof memory p2 = p;
        p2.outputCommitments = [_fe("x0"), _fe("x1")];
        p2.root = pool.getLastRoot();
        vm.expectRevert(UmbraShieldedPool.NoteAlreadySpent.selector);
        pool.transact(p2, ext);
    }

    function test_RejectsUnknownRoot() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 0, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, 0xdead);
        vm.expectRevert(UmbraShieldedPool.UnknownRoot.selector);
        pool.transact(p, ext);
    }

    function test_RejectsExtDataHashMismatch() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 0, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        p.extDataHash = p.extDataHash ^ 1; // tamper
        vm.expectRevert(UmbraShieldedPool.ExtDataHashMismatch.selector);
        pool.transact(p, ext);
    }

    function test_RejectsPublicAmountMismatch() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 100, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        p.publicAmount = p.publicAmount + 1; // tamper
        vm.deal(address(this), 100);
        vm.expectRevert(UmbraShieldedPool.PublicAmountMismatch.selector);
        pool.transact{value: 100}(p, ext);
    }

    function test_RejectsBadProof() public {
        UmbraShieldedPool.ExtData memory ext = _ext(address(0), 0, address(0), 0);
        UmbraShieldedPool.Proof memory p = _proof(ext, pool.getLastRoot());
        verifier.setShouldVerify(false);
        vm.expectRevert(UmbraShieldedPool.InvalidProof.selector);
        pool.transact(p, ext);
    }

    receive() external payable {}
}
