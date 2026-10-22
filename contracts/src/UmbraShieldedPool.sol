// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleTreeWithHistoryPair} from "./MerkleTreeWithHistoryPair.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraShieldedPool
/// @notice The join-split (UTXO) shielded pool — the SHARED ENGINE for arbitrary-value
///         private transfers. One `transact` can deposit, withdraw, and privately transfer
///         value between shielded owners at once, consuming up to 2 input notes and
///         creating 2 outputs, all while hiding amounts and the input/output links.
///
///         This is what the DEX / voting / payroll variants build on: they are just this
///         pool with domain logic layered on top. Verification is VM-agnostic (on-chain
///         Groth16 or the WASM coprocessor) via IVerifier.
contract UmbraShieldedPool is MerkleTreeWithHistoryPair {
    IVerifier public immutable verifier;

    uint256 public constant MAX_EXT_AMOUNT = 2 ** 248;
    uint256 public constant MAX_FEE = 2 ** 248;

    mapping(uint256 => bool) public nullifierHashes;

    uint256 private _locked = 1;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256 root;
        uint256 publicAmount;
        uint256 extDataHash;
        uint256[2] inputNullifiers;
        uint256[2] outputCommitments;
    }

    /// @dev Amounts are 18-decimal EVM wei (pallet-revive scales native 14-dec POT by 10^4).
    struct ExtData {
        address recipient;
        int256 extAmount; // >0 deposit, <0 withdraw, 0 internal transfer
        address relayer;
        uint256 fee;
        bytes encryptedOutput1;
        bytes encryptedOutput2;
    }

    event NewCommitment(uint256 indexed commitment, uint256 index, bytes encryptedOutput);
    event NewNullifier(uint256 indexed nullifier);

    error AlreadyLocked();
    error UnknownRoot();
    error NoteAlreadySpent();
    error ExtDataHashMismatch();
    error PublicAmountMismatch();
    error InvalidProof();
    error InvalidDepositValue();
    error InvalidWithdrawValue();
    error FeeTooLarge();
    error ExtAmountOutOfRange();
    error PaymentFailed();
    error InvalidRecipient();
    error InvalidRelayer();

    modifier nonReentrant() {
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IVerifier _verifier, IHasher _hasher, uint32 _levels)
        MerkleTreeWithHistoryPair(_levels, _hasher)
    {
        verifier = _verifier;
    }

    /// @notice Field-encoded signed public amount: extAmount - fee, wrapped into the field.
    function calculatePublicAmount(int256 extAmount, uint256 fee) public pure returns (uint256) {
        if (fee >= MAX_FEE) revert FeeTooLarge();
        if (extAmount <= -int256(MAX_EXT_AMOUNT) || extAmount >= int256(MAX_EXT_AMOUNT)) {
            revert ExtAmountOutOfRange();
        }
        int256 publicAmount = extAmount - int256(fee);
        return publicAmount >= 0 ? uint256(publicAmount) : FIELD_SIZE - uint256(-publicAmount);
    }

    function isSpent(uint256 nullifierHash) public view returns (bool) {
        return nullifierHashes[nullifierHash];
    }

    /// @notice Execute a shielded join-split transaction.
    function transact(Proof calldata args, ExtData calldata extData) external payable nonReentrant {
        if (!isKnownRoot(args.root)) revert UnknownRoot();
        if (nullifierHashes[args.inputNullifiers[0]]) revert NoteAlreadySpent();
        if (nullifierHashes[args.inputNullifiers[1]]) revert NoteAlreadySpent();
        if (uint256(keccak256(abi.encode(extData))) % FIELD_SIZE != args.extDataHash) {
            revert ExtDataHashMismatch();
        }
        if (calculatePublicAmount(extData.extAmount, extData.fee) != args.publicAmount) {
            revert PublicAmountMismatch();
        }
        // never burn funds by paying out to the zero address
        if (extData.extAmount < 0 && extData.recipient == address(0)) revert InvalidRecipient();
        if (extData.fee > 0 && extData.relayer == address(0)) revert InvalidRelayer();

        uint256[] memory pub = new uint256[](7);
        pub[0] = args.root;
        pub[1] = args.publicAmount;
        pub[2] = args.extDataHash;
        pub[3] = args.inputNullifiers[0];
        pub[4] = args.inputNullifiers[1];
        pub[5] = args.outputCommitments[0];
        pub[6] = args.outputCommitments[1];
        if (!verifier.verifyProof(args.a, args.b, args.c, pub)) revert InvalidProof();

        // effects: spend inputs
        nullifierHashes[args.inputNullifiers[0]] = true;
        nullifierHashes[args.inputNullifiers[1]] = true;
        emit NewNullifier(args.inputNullifiers[0]);
        emit NewNullifier(args.inputNullifiers[1]);

        // value in/out
        if (extData.extAmount > 0) {
            if (msg.value != uint256(extData.extAmount)) revert InvalidDepositValue();
        } else if (msg.value != 0) {
            revert InvalidWithdrawValue();
        }

        // insert outputs
        uint32 index = _insert(args.outputCommitments[0], args.outputCommitments[1]);
        emit NewCommitment(args.outputCommitments[0], index, extData.encryptedOutput1);
        emit NewCommitment(args.outputCommitments[1], index + 1, extData.encryptedOutput2);

        // payouts
        if (extData.extAmount < 0) {
            _pay(extData.recipient, uint256(-extData.extAmount));
        }
        if (extData.fee > 0) {
            _pay(extData.relayer, extData.fee);
        }
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }
}
