// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UmbraPool} from "../src/UmbraPool.sol";
import {UmbraPoolBase} from "../src/UmbraPoolBase.sol";
import {UmbraShieldedPool} from "../src/UmbraShieldedPool.sol";
import {UmbraCoprocessorBridge} from "../src/UmbraCoprocessorBridge.sol";
import {MerkleTreeWithHistory} from "../src/MerkleTreeWithHistory.sol";
import {IHasher} from "../src/interfaces/IHasher.sol";
import {PoseidonDeployer} from "./helpers/PoseidonDeployer.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";

/// @notice One regression test per contract-level audit finding (see AUDIT_REPORT.md).
contract AuditRegressionsTest is Test {
    uint256 constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    IHasher hasher;
    MockVerifier verifier;

    function setUp() public {
        hasher = PoseidonDeployer.deploy(vm);
        verifier = new MockVerifier();
    }

    // I-01: the "nothing-up-my-sleeve" zero leaf really is keccak256("umbra.v3.zero") % FIELD
    function test_I01_ZeroValueIsDerivedFromSeed() public {
        UmbraPool pool = new UmbraPool(verifier, hasher, 1 ether, 20);
        assertEq(pool.ZERO_VALUE(), uint256(keccak256("umbra.v3.zero")) % FIELD);
        UmbraShieldedPool sp = new UmbraShieldedPool(verifier, hasher, 20);
        assertEq(sp.ZERO_VALUE(), uint256(keccak256("umbra.v3.zero")) % FIELD);
    }

    // L-01: withdraw is non-payable, so value can never be locked in it
    function test_L01_WithdrawRejectsValue() public {
        UmbraPool pool = new UmbraPool(verifier, hasher, 1 ether, 20);
        vm.deal(address(this), 2 ether);
        pool.deposit{value: 1 ether}(123, "");
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        bytes memory data = abi.encodeCall(
            UmbraPoolBase.withdraw, (a, b, c, pool.getLastRoot(), 7, payable(address(0xBEEF)), payable(address(0xBEEF)), 0, 0)
        );
        (bool ok,) = address(pool).call{value: 1 wei}(data);
        assertFalse(ok, "sending value to withdraw must revert");
    }

    // L-02: join-split never pays to address(0)
    function test_L02_ShieldedRejectsZeroRecipientAndRelayer() public {
        UmbraShieldedPool sp = new UmbraShieldedPool(verifier, hasher, 20);
        // fund pool
        UmbraShieldedPool.ExtData memory dep = UmbraShieldedPool.ExtData(address(0), 100, address(0), 0, "", "");
        UmbraShieldedPool.Proof memory p = _proof(sp, dep, 1);
        vm.deal(address(this), 100);
        sp.transact{value: 100}(p, dep);

        UmbraShieldedPool.ExtData memory w = UmbraShieldedPool.ExtData(address(0), -10, address(0), 0, "", "");
        UmbraShieldedPool.Proof memory pw = _proof(sp, w, 2);
        vm.expectRevert(UmbraShieldedPool.InvalidRecipient.selector);
        sp.transact(pw, w);

        UmbraShieldedPool.ExtData memory f = UmbraShieldedPool.ExtData(address(0xCAFE), -10, address(0), 1, "", "");
        UmbraShieldedPool.Proof memory pf = _proof(sp, f, 3);
        vm.expectRevert(UmbraShieldedPool.InvalidRelayer.selector);
        sp.transact(pf, f);
    }

    // M-01: attestations are only accepted from the attestor and are domain-separated
    function test_M01_BridgeOnlyAttestor() public {
        UmbraCoprocessorBridge br = new UmbraCoprocessorBridge(address(0), address(this));
        vm.prank(address(0xBAD));
        vm.expectRevert(UmbraCoprocessorBridge.NotAttestor.selector);
        br.attest(bytes32(uint256(1)));
    }

    function test_M01_BridgeAttestationFlowAndBinding() public {
        UmbraCoprocessorBridge br = new UmbraCoprocessorBridge(address(0), address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _dummyProof();

        assertFalse(br.verifyProof(a, b, c, pub), "unattested proof must fail");
        br.attest(br.proofHashOf(a, b, c, pub));
        assertTrue(br.verifyProof(a, b, c, pub), "attested proof must pass");

        pub[0] = pub[0] + 1; // different public input => different hash
        assertFalse(br.verifyProof(a, b, c, pub), "attestation must not cover other inputs");
    }

    function test_M01_AttestationNotReplayableAcrossBridges() public {
        UmbraCoprocessorBridge br1 = new UmbraCoprocessorBridge(address(0), address(this));
        UmbraCoprocessorBridge br2 = new UmbraCoprocessorBridge(address(0), address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _dummyProof();

        bytes32 h1 = br1.proofHashOf(a, b, c, pub);
        assertTrue(h1 != br2.proofHashOf(a, b, c, pub), "hash must bind the bridge address");
        br1.attest(h1);
        br2.attest(h1); // replaying bridge-1's hash on bridge-2 ...
        assertFalse(br2.verifyProof(a, b, c, pub), "... must not validate the proof on bridge-2");
    }

    function test_M01_BridgeRejectsCodelessCoprocessor() public {
        vm.expectRevert(UmbraCoprocessorBridge.CoprocessorHasNoCode.selector);
        new UmbraCoprocessorBridge(address(0x1234567890), address(this));
    }

    // ---- helpers ----
    function _dummyProof()
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub)
    {
        a = [uint256(1), 2];
        b = [[uint256(3), 4], [uint256(5), 6]];
        c = [uint256(7), 8];
        pub = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) pub[i] = i + 10;
    }

    function _proof(UmbraShieldedPool sp, UmbraShieldedPool.ExtData memory ext, uint256 salt)
        internal
        view
        returns (UmbraShieldedPool.Proof memory p)
    {
        p.root = sp.getLastRoot();
        p.publicAmount = sp.calculatePublicAmount(ext.extAmount, ext.fee);
        p.extDataHash = uint256(keccak256(abi.encode(ext))) % FIELD;
        p.inputNullifiers = [uint256(keccak256(abi.encode("n0", salt))) % FIELD, uint256(keccak256(abi.encode("n1", salt))) % FIELD];
        p.outputCommitments = [uint256(keccak256(abi.encode("c0", salt))) % FIELD, uint256(keccak256(abi.encode("c1", salt))) % FIELD];
    }

    receive() external payable {}
}
