// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../../src/interfaces/IVerifier.sol";

/// @notice MEASUREMENT ONLY — never deployed. Dry-run-instantiated on a live Portaldot runtime
///         to prove that a REAL Groth16 proof verifies there (BN254 pairing inside revive).
///         The constructor deploys the verifier, verifies, and returns the boolean as its
///         "runtime code" (32 bytes), which the dry-run result exposes.
contract VerifyHarness {
    constructor(bytes memory verifierInit, uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c, uint256[] memory pub) {
        address v;
        assembly {
            v := create(0, add(verifierInit, 0x20), mload(verifierInit))
        }
        require(v != address(0), "verifier deploy failed");
        bool ok = IVerifier(v).verifyProof(a, b, c, pub);
        assembly {
            mstore(0, ok)
            return(0, 32)
        }
    }
}
