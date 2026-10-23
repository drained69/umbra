// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice MEASUREMENT ONLY — never deployed. scripts/estimate-deploy.js dry-run-instantiates
///         it to price a full Umbra deployment on a live Portaldot runtime. Every contract's
///         initcode is passed as DATA (not embedded), so the harness's own code is tiny and
///         the measured deposit is essentially the real deployment's.
contract DeployHarness {
    function _create(bytes memory init) private returns (address a) {
        assembly {
            a := create(0, add(init, 0x20), mload(init))
        }
        require(a != address(0), "create failed");
    }

    constructor(
        bytes memory poseidonInit,
        bytes memory withdrawVerifierInit,
        bytes memory txVerifierInit,
        bytes memory poolCode, // UmbraPool creation code (no args)
        bytes memory tokenPoolCode, // UmbraTokenPool creation code (no args)
        bytes memory shieldedCode, // UmbraShieldedPool creation code (no args), empty = skip
        uint256[] memory nativeDenoms,
        address token,
        uint256[] memory tokenDenoms
    ) {
        address hasher = _create(poseidonInit);
        address wv = _create(withdrawVerifierInit);
        for (uint256 i = 0; i < nativeDenoms.length; i++) {
            _create(abi.encodePacked(poolCode, abi.encode(wv, hasher, nativeDenoms[i], uint32(20))));
        }
        for (uint256 i = 0; i < tokenDenoms.length; i++) {
            _create(abi.encodePacked(tokenPoolCode, abi.encode(wv, hasher, token, tokenDenoms[i], uint32(20))));
        }
        if (shieldedCode.length > 0) {
            address tv = _create(txVerifierInit);
            _create(abi.encodePacked(shieldedCode, abi.encode(tv, hasher, uint32(20))));
        }
    }
}
