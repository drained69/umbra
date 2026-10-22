// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "../../src/interfaces/IVerifier.sol";

/// @notice Test-only verifier with a settable return value, so we can test both the
///         accept and reject branches of the pool deterministically. The real proof
///         system (snarkjs Groth16 on-chain, or the WASM coprocessor) replaces this.
contract MockVerifier is IVerifier {
    bool public shouldVerify = true;

    function setShouldVerify(bool v) external {
        shouldVerify = v;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        view
        returns (bool)
    {
        return shouldVerify;
    }
}
