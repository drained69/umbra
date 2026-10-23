// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UmbraPool} from "../../src/UmbraPool.sol";
import {UmbraShieldedPool} from "../../src/UmbraShieldedPool.sol";
import {IHasher} from "../../src/interfaces/IHasher.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";

/// @notice MEASUREMENT ONLY — never deployed. Dry-run-instantiated on Portaldot (read-only)
///         by scripts/measure-costs.js to price real operations against the live runtime:
///         its constructor deploys the real Poseidon + pools and performs N operations.
///         Comparing runs with different N isolates the per-operation storage deposit.
contract CostHarness {
    uint256 constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @param poseidonCode circomlibjs Poseidon(2) initcode
    /// @param mode 0 = fixed pool, 1 = join-split pool
    /// @param deposits number of deposits (mode 0) or join-split deposits (mode 1)
    /// @param withdrawals number of withdrawals (mode 0) / internal transfers (mode 1)
    constructor(bytes memory poseidonCode, uint8 mode, uint256 deposits, uint256 withdrawals) payable {
        address hasher;
        assembly {
            hasher := create(0, add(poseidonCode, 0x20), mload(poseidonCode))
        }
        require(hasher != address(0), "poseidon deploy failed");
        IVerifier v = IVerifier(address(new MockVerifier()));

        if (mode == 0) {
            UmbraPool pool = new UmbraPool(v, IHasher(hasher), 1 ether, 20);
            for (uint256 i = 0; i < deposits; i++) pool.deposit{value: 1 ether}(i + 1, "");
            uint256[2] memory a;
            uint256[2][2] memory b;
            uint256[2] memory c;
            for (uint256 i = 0; i < withdrawals; i++) {
                pool.withdraw(a, b, c, pool.getLastRoot(), 1000 + i, payable(address(this)), payable(address(this)), 0, 0);
            }
        } else {
            UmbraShieldedPool sp = new UmbraShieldedPool(v, IHasher(hasher), 20);
            for (uint256 i = 0; i < deposits + withdrawals; i++) {
                bool isDeposit = i < deposits;
                UmbraShieldedPool.ExtData memory ext =
                    UmbraShieldedPool.ExtData(address(0), isDeposit ? int256(1 ether) : int256(0), address(0), 0, "", "");
                UmbraShieldedPool.Proof memory p;
                p.root = sp.getLastRoot();
                p.publicAmount = sp.calculatePublicAmount(ext.extAmount, 0);
                p.extDataHash = uint256(keccak256(abi.encode(ext))) % FIELD;
                p.inputNullifiers = [uint256(keccak256(abi.encode("n0", i))) % FIELD, uint256(keccak256(abi.encode("n1", i))) % FIELD];
                p.outputCommitments = [uint256(keccak256(abi.encode("c0", i))) % FIELD, uint256(keccak256(abi.encode("c1", i))) % FIELD];
                sp.transact{value: isDeposit ? 1 ether : 0}(p, ext);
            }
        }
    }

    receive() external payable {}
}
