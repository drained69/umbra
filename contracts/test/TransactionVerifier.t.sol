// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TransactionVerifier} from "../src/verifiers/TransactionVerifier.sol";

/// @notice Proves the generated join-split verifier accepts a REAL Groth16 proof from
///         circuits/scripts/prove_transaction.js, and rejects a tampered public signal.
/// @dev Requires: node circuits/scripts/prove_transaction.js (writes tx_proof.json).
contract TransactionVerifierTest is Test {
    TransactionVerifier verifier;
    string json;

    function setUp() public {
        verifier = new TransactionVerifier();
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/tx_proof.json"));
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

    function test_AcceptsRealJoinSplitProof() public view {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _load();
        assertEq(pub.length, 7, "join-split has 7 public signals");
        assertTrue(verifier.verifyProof(a, b, c, pub), "real join-split proof must verify");
    }

    function test_RejectsTamperedPublicAmount() public view {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) = _load();
        pub[1] = pub[1] ^ 1; // flip publicAmount — breaks value conservation binding
        assertFalse(verifier.verifyProof(a, b, c, pub), "tampered publicAmount must be rejected");
    }
}
