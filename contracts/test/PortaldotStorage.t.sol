// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {UmbraPool} from "../src/UmbraPool.sol";
import {UmbraShieldedPool} from "../src/UmbraShieldedPool.sol";
import {MerkleTreeWithHistory} from "../src/MerkleTreeWithHistory.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockHasher} from "./mocks/MockHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";

/// @notice Properties of the Portaldot storage-minimal layout:
///   1. on-chain roots == the SDK's off-chain MerkleTree roots (real Poseidon bytecode);
///   2. a deposit creates NO new storage slots (every new slot locks ~3.84 tPOT on Portaldot);
///   3. a withdrawal creates exactly ONE (its nullifier);
///   4. the pre-allocated root sentinel can never be accepted as a root;
///   5. pools refuse a hasher that isn't Poseidon(2).
contract PortaldotStorageTest is Test {
    IHasher poseidon;
    MockVerifier verifier;
    string roots;

    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;

    function setUp() public {
        poseidon = PoseidonDeployer.deploy(vm);
        verifier = new MockVerifier();
        roots = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/roots.json"));
    }

    function test_FixedTreeRootsMatchSdk() public {
        UmbraPool pool = new UmbraPool(verifier, poseidon, 1 ether, 20);
        assertEq(pool.getLastRoot(), vm.parseJsonUint(roots, ".empty"), "empty root");
        uint256[] memory leaves = vm.parseJsonUintArray(roots, ".leaves");
        uint256[] memory expected = vm.parseJsonUintArray(roots, ".fixed");
        vm.deal(address(this), 10 ether);
        for (uint256 i = 0; i < leaves.length; i++) {
            pool.deposit{value: 1 ether}(leaves[i], "");
            assertEq(pool.getLastRoot(), expected[i], "root after deposit");
        }
    }

    function test_PairTreeRootsMatchSdk() public {
        UmbraShieldedPool sp = new UmbraShieldedPool(verifier, poseidon, 20);
        uint256[] memory expected = vm.parseJsonUintArray(roots, ".pair");
        for (uint256 i = 0; i < expected.length; i++) {
            UmbraShieldedPool.ExtData memory ext = UmbraShieldedPool.ExtData(address(0), 0, address(0), 0, "", "");
            UmbraShieldedPool.Proof memory p;
            p.root = sp.getLastRoot();
            p.publicAmount = 0;
            p.extDataHash = uint256(keccak256(abi.encode(ext))) % sp.FIELD_SIZE();
            p.inputNullifiers = [uint256(1000 + 2 * i), uint256(1001 + 2 * i)];
            p.outputCommitments = [uint256(11 + 2 * i), uint256(12 + 2 * i)];
            sp.transact(p, ext);
            assertEq(sp.getLastRoot(), expected[i], "root after pair insert");
        }
    }

    function _newSlots(Vm.AccountAccess[] memory accesses, address target) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < accesses.length; i++) {
            if (accesses[i].account != target) continue;
            Vm.StorageAccess[] memory s = accesses[i].storageAccesses;
            for (uint256 j = 0; j < s.length; j++) {
                if (s[j].isWrite && !s[j].reverted && s[j].previousValue == bytes32(0) && s[j].newValue != bytes32(0)) n++;
            }
        }
    }

    function test_DepositCreatesNoNewSlots() public {
        UmbraPool pool = new UmbraPool(verifier, poseidon, 1 ether, 20);
        vm.deal(address(this), 40 ether);
        // cover every root ring-buffer slot and many tree shapes
        for (uint256 i = 1; i <= 30; i++) {
            vm.startStateDiffRecording();
            pool.deposit{value: 1 ether}(i, "");
            assertEq(_newSlots(vm.stopAndReturnStateDiff(), address(pool)), 0, "deposit must not allocate storage");
        }
    }

    function test_WithdrawCreatesExactlyOneSlot() public {
        UmbraPool pool = new UmbraPool(verifier, poseidon, 1 ether, 20);
        vm.deal(address(this), 1 ether);
        pool.deposit{value: 1 ether}(7, "");
        uint256 root = pool.getLastRoot();
        vm.startStateDiffRecording();
        pool.withdraw(a, b, c, root, 99, payable(makeAddr("r")), payable(makeAddr("r")), 0, 0);
        assertEq(_newSlots(vm.stopAndReturnStateDiff(), address(pool)), 1, "only the nullifier slot");
    }

    function test_JoinSplitCreatesOnlyNullifierSlots() public {
        UmbraShieldedPool sp = new UmbraShieldedPool(verifier, poseidon, 20);
        for (uint256 i = 0; i < 14; i++) {
            UmbraShieldedPool.ExtData memory ext = UmbraShieldedPool.ExtData(address(0), 0, address(0), 0, "", "");
            UmbraShieldedPool.Proof memory p;
            p.root = sp.getLastRoot();
            p.extDataHash = uint256(keccak256(abi.encode(ext))) % sp.FIELD_SIZE();
            p.inputNullifiers = [uint256(5000 + 2 * i), uint256(5001 + 2 * i)];
            p.outputCommitments = [uint256(1 + i), uint256(100 + i)];
            vm.startStateDiffRecording();
            sp.transact(p, ext);
            assertEq(_newSlots(vm.stopAndReturnStateDiff(), address(sp)), 2, "exactly two nullifier slots");
        }
    }

    function test_RootSentinelIsNeverKnown() public {
        UmbraPool pool = new UmbraPool(verifier, poseidon, 1 ether, 20);
        assertFalse(pool.isKnownRoot(type(uint256).max));
        assertFalse(pool.isKnownRoot(pool.FIELD_SIZE()));
        assertFalse(pool.isKnownRoot(0));
        assertTrue(pool.isKnownRoot(pool.getLastRoot()));
    }

    function test_RejectsNonPoseidonHasher() public {
        IHasher keccakHasher = IHasher(address(new MockHasher()));
        vm.expectRevert(MerkleTreeWithHistory.HasherMismatch.selector);
        new UmbraPool(verifier, keccakHasher, 1 ether, 20);
    }

    receive() external payable {}
}
