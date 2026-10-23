// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {IHasher} from "../../src/interfaces/IHasher.sol";

/// @notice Deploys the REAL circomlibjs Poseidon(2) bytecode (the exact bytes scripts/deploy.js
///         ships) so contract tests exercise the production hash, not a stand-in.
library PoseidonDeployer {
    function deploy(Vm vm) internal returns (IHasher h) {
        bytes memory code = vm.parseBytes(vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/poseidon2.hex")));
        address addr;
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "poseidon deploy failed");
        h = IHasher(addr);
    }
}
