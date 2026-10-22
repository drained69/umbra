// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";

/// @notice Proves the snarkjs-generated on-chain verifier accepts a REAL Groth16 proof
///         produced by circuits/scripts/prove_example.js, and rejects a tampered one.
///         This is the on-chain half of the end-to-end ZK check.
/// @dev Requires the fixture: run `node circuits/scripts/prove_example.js` first.
contract WithdrawVerifierTest is Test {
    WithdrawVerifier verifier;
    string json;

    function setUp() public {
        verifier = new WithdrawVerifier();
        string memory p = string.concat(vm.projectRoot(), "/test/fixtures/proof.json");
        json = vm.readFile(p);
    }

    function _load()
        internal
        view
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub)
    {
        uint256[] memory aFlat = vm.parseJsonUintArray(json, ".aFlat");
        uint256[] memory bFlat = vm.parseJsonUintArray(json, ".bFlat");
        uint256[] memory cFlat = vm.parseJsonUintArray(json, ".cFlat");
        pub = vm.parseJsonUintArray(json, ".pub");

        a = [aFlat[0], aFlat[1]];
        b = [[bFlat[0], bFlat[1]], [bFlat[2], bFlat[3]]];
        c = [cFlat[0], cFlat[1]];
    }

    function test_AcceptsRealProof() public view {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _load();
        assertTrue(verifier.verifyProof(a, b, c, pub), "real proof must verify on-chain");
    }

    function test_RejectsTamperedPublicSignal() public view {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _load();
        // flip the recipient (index 2) — proof is bound to it, so verification must fail
        pub[2] = pub[2] ^ 1;
        assertFalse(verifier.verifyProof(a, b, c, pub), "tampered recipient must be rejected");
    }
}
