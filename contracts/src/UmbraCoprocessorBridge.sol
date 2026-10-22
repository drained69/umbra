// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraCoprocessorBridge
/// @notice An IVerifier whose Groth16 pairing check is executed by the ink!/WASM contract
///         `umbra_coprocessor` (Portaldot V3's second VM) instead of the EVM.
///
/// @dev Two wiring modes (see docs/CROSS_VM.md); the pool interface is identical:
///        1. Direct: `coprocessor` is an EVM-reachable precompile / chain-extension shim
///           that forwards to pallet-contracts. The bridge staticcalls it.
///        2. Attested (testnet): a designated `attestor` runs the WASM verification and
///           records the result here via `attest(proofHash)`.
///
///      SECURITY (audit M-01): attestations are domain-separated. A proof hash binds
///      chainid + this bridge's address + the exact proof and public signals, so an
///      attestation can't be replayed on another bridge (e.g. the other circuit's bridge),
///      another chain, or for different public inputs. Deploy ONE bridge per circuit.
contract UmbraCoprocessorBridge is IVerifier {
    address public immutable coprocessor;
    address public immutable attestor;

    mapping(bytes32 => bool) public attested;

    event Attested(bytes32 indexed proofHash);

    error NotAttestor();
    error CoprocessorHasNoCode();

    constructor(address _coprocessor, address _attestor) {
        if (_coprocessor != address(0) && _coprocessor.code.length == 0 && _coprocessor > address(0xffff)) {
            // Non-precompile addresses must be real contracts; precompile-range addresses
            // (<= 0xffff) are allowed since runtime shims may not report code.
            revert CoprocessorHasNoCode();
        }
        coprocessor = _coprocessor;
        attestor = _attestor;
    }

    /// @notice Canonical, domain-separated hash of a proof. The attestor MUST use this.
    function proofHashOf(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), a, b, c, publicSignals));
    }

    /// @notice Attestor path: mirror a WASM-verified proof result on-chain.
    function attest(bytes32 proofHash) external {
        if (msg.sender != attestor) revert NotAttestor();
        attested[proofHash] = true;
        emit Attested(proofHash);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool) {
        if (coprocessor != address(0)) {
            // Direct cross-VM path. ABI: verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[]) -> bool
            (bool ok, bytes memory out) =
                coprocessor.staticcall(abi.encodeCall(IVerifier.verifyProof, (a, b, c, publicSignals)));
            if (ok && out.length == 32) {
                return abi.decode(out, (bool));
            }
        }
        return attested[proofHashOf(a, b, c, publicSignals)];
    }
}
