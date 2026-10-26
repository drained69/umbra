// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleTreeWithHistoryPair} from "./MerkleTreeWithHistoryPair.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraMultiAssetPool
/// @notice Join-split shielded pool holding several assets (native tPOT plus ERC-20s such as
///         the pUSD asset precompile) in one Merkle tree, so they share one anonymity set.
///         Every note commits to its asset id; a transaction moves one asset.
///
///         Private swap: a proof may also mint a note of a second asset (`swapAmount` of
///         `swapAsset`). The contract accepts it only when the caller is the proof's
///         `recipient` and delivers exactly that amount of `swapAsset` in the same call, while
///         it is paid the trader's `-extAmount` of `publicAsset`. The trader never signs or
///         appears on chain: a relayer acts as counterparty (and sources the asset on a DEX in
///         the same extrinsic). Either the trader gets the bought note or nothing happens, and
///         because only the named recipient can submit a swap proof, a leaked proof cannot be
///         used by anyone else.
contract UmbraMultiAssetPool is MerkleTreeWithHistoryPair {
    IVerifier public immutable verifier;

    uint256 public constant MAX_EXT_AMOUNT = 2 ** 248;
    uint256 public constant MAX_FEE = 2 ** 248;

    /// @notice Asset id -> token; id 0 is the native token (address(0)).
    address[] private _assets;

    mapping(uint256 => bool) public nullifierHashes;

    uint256 private _locked = 1;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256 root;
        uint256 publicAmount;
        uint256 extDataHash;
        uint256 publicAsset;
        uint256 swapAsset;
        uint256 swapAmount;
        uint256[2] inputNullifiers;
        uint256[2] outputCommitments;
    }

    /// @dev Amounts are in each asset's own units (native: 18-decimal EVM wei).
    struct ExtData {
        address recipient;
        int256 extAmount; // >0 deposit, <0 withdraw (or swap payout), 0 internal transfer
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
    error FeeTooLarge();
    error ExtAmountOutOfRange();
    error PaymentFailed();
    error InvalidRecipient();
    error InvalidRelayer();
    error UnknownAsset();
    error InvalidSwap();
    error NotSwapCounterparty();
    error TokenTransferFailed();
    error UnsupportedToken();
    error InvalidConfig();

    modifier nonReentrant() {
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param tokens ERC-20 assets with ids 1..n (id 0 is always the native token).
    constructor(IVerifier _verifier, IHasher _hasher, uint32 _levels, address[] memory tokens)
        MerkleTreeWithHistoryPair(_levels, _hasher)
    {
        verifier = _verifier;
        _assets.push(address(0));
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert InvalidConfig();
            for (uint256 j = 0; j < i; j++) {
                if (tokens[j] == tokens[i]) revert InvalidConfig();
            }
            _assets.push(tokens[i]);
        }
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assetAddress(uint256 id) external view returns (address) {
        if (id >= _assets.length) revert UnknownAsset();
        return _assets[id];
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

    /// @notice Execute a shielded join-split transaction, optionally with a swap leg.
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
        if (args.publicAsset >= _assets.length) revert UnknownAsset();
        bool swap = args.swapAmount != 0;
        if (swap) {
            // the trader pays out its asset to the counterparty, who must deliver the other one
            if (args.swapAsset >= _assets.length) revert UnknownAsset();
            if (args.swapAsset == args.publicAsset || args.swapAmount >= MAX_EXT_AMOUNT || extData.extAmount >= 0) {
                revert InvalidSwap();
            }
            if (msg.sender != extData.recipient) revert NotSwapCounterparty();
        } else if (args.swapAsset != 0) {
            revert InvalidSwap(); // one canonical encoding per transaction
        }
        // never burn funds by paying out to the zero address
        if (extData.extAmount < 0 && extData.recipient == address(0)) revert InvalidRecipient();
        if (extData.fee > 0 && extData.relayer == address(0)) revert InvalidRelayer();

        uint256[] memory pub = new uint256[](10);
        pub[0] = args.root;
        pub[1] = args.publicAmount;
        pub[2] = args.extDataHash;
        pub[3] = args.publicAsset;
        pub[4] = args.swapAsset;
        pub[5] = args.swapAmount;
        pub[6] = args.inputNullifiers[0];
        pub[7] = args.inputNullifiers[1];
        pub[8] = args.outputCommitments[0];
        pub[9] = args.outputCommitments[1];
        if (!verifier.verifyProof(args.a, args.b, args.c, pub)) revert InvalidProof();

        // effects: spend inputs, insert outputs
        nullifierHashes[args.inputNullifiers[0]] = true;
        nullifierHashes[args.inputNullifiers[1]] = true;
        emit NewNullifier(args.inputNullifiers[0]);
        emit NewNullifier(args.inputNullifiers[1]);
        uint32 index = _insert(args.outputCommitments[0], args.outputCommitments[1]);
        emit NewCommitment(args.outputCommitments[0], index, extData.encryptedOutput1);
        emit NewCommitment(args.outputCommitments[1], index + 1, extData.encryptedOutput2);

        // value in: a deposit of publicAsset, and/or the counterparty's swap delivery
        uint256 nativeIn = 0;
        if (extData.extAmount > 0) {
            nativeIn += _pullIn(args.publicAsset, uint256(extData.extAmount));
        }
        if (swap) {
            nativeIn += _pullIn(args.swapAsset, args.swapAmount);
        }
        if (msg.value != nativeIn) revert InvalidDepositValue();

        // value out, in publicAsset
        if (extData.extAmount < 0) {
            _pay(args.publicAsset, extData.recipient, uint256(-extData.extAmount));
        }
        if (extData.fee > 0) {
            _pay(args.publicAsset, extData.relayer, extData.fee);
        }
    }

    /// @dev Pulls an ERC-20 from the caller; for the native asset returns the msg.value owed.
    function _pullIn(uint256 asset, uint256 amount) private returns (uint256 nativeOwed) {
        address token = _assets[asset];
        if (token == address(0)) return amount;
        uint256 before = _balance(token);
        _call(token, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount)); // transferFrom
        if (_balance(token) - before != amount) revert UnsupportedToken(); // fee-on-transfer etc.
        return 0;
    }

    function _pay(uint256 asset, address to, uint256 amount) private {
        address token = _assets[asset];
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert PaymentFailed();
        } else {
            _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount)); // transfer
        }
    }

    function _balance(address token) private view returns (uint256) {
        (bool ok, bytes memory out) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || out.length < 32) revert TokenTransferFailed();
        return abi.decode(out, (uint256));
    }

    /// @dev SafeERC20-style: succeed on empty return data or `true`.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory out) = token.call(data);
        if (!ok || (out.length != 0 && (out.length < 32 || !abi.decode(out, (bool))))) revert TokenTransferFailed();
    }
}
