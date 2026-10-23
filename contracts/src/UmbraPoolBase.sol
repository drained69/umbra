// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraPoolBase
/// @notice Asset-agnostic fixed-denomination shielded pool. Deposits add a note commitment to
///         the Merkle tree; withdrawals prove in zero knowledge that the caller knows an
///         unspent note WITHOUT revealing which one. Concrete pools only define how value
///         moves in (`_pullDeposit`) and out (`_pushPayout`):
///           - UmbraPool       — native tPOT (18-dec EVM units; native POT is 14-dec ×10^4)
///           - UmbraTokenPool  — any ERC-20, incl. every Portaldot asset via its ERC-20
///                               precompile at 0x{assetId:08x}000000000000000000000000 00010000
///
/// @dev Verification is VM-agnostic: `verifier` is the snarkjs Groth16 verifier OR the
///      UmbraCoprocessorBridge (WASM coprocessor). Relayer support: `fee` is paid to the
///      proof-bound `relayer`, so recipients can be fresh addresses that never held gas.
abstract contract UmbraPoolBase is MerkleTreeWithHistory {
    IVerifier public immutable verifier;
    uint256 public immutable denomination;

    /// The ONE storage slot a withdrawal creates (~3.84 tPOT on Portaldot, paid by the
    /// submitter — relayer fees must cover it). Deposits create no new slots.
    mapping(uint256 => bool) public nullifierHashUsed;

    uint256 private _locked = 1;

    error AlreadyLocked();
    error InvalidDenomination();
    error UnknownRoot();
    error NoteAlreadySpent();
    error FeeExceedsDenomination();
    error InvalidProof();
    error RefundNotSupported();
    error PaymentFailed();

    /// @param nullifierHash the spent note's nullifier hash
    /// @param to the recipient
    /// @param relayer the proof-bound fee receiver (== to for self-withdrawals)
    /// @param fee amount paid to the relayer out of the denomination
    event Withdrawal(uint256 indexed nullifierHash, address indexed to, address indexed relayer, uint256 fee);

    /// @param encryptedMemo optional READ-ONLY viewing-key ciphertext (never spend secrets)
    event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp, bytes encryptedMemo);

    modifier nonReentrant() {
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IVerifier _verifier, IHasher _hasher, uint256 _denomination, uint32 _levels)
        MerkleTreeWithHistory(_levels, _hasher)
    {
        if (_denomination == 0) revert InvalidDenomination();
        verifier = _verifier;
        denomination = _denomination;
    }

    /// @notice The pooled asset: address(0) for native tPOT, otherwise the ERC-20 address.
    function token() public view virtual returns (address);

    /// @notice Shield `denomination` behind `commitment = Poseidon(nullifier, secret)`.
    /// @dev No duplicate-commitment check (it would cost every depositor a ~3.84 tPOT storage
    ///      slot on Portaldot). Safe: a copied commitment only gives its secret holder an extra
    ///      leaf; the shared nullifier still allows exactly one withdrawal for that secret.
    function deposit(uint256 commitment, bytes calldata encryptedMemo) external payable nonReentrant {
        _pullDeposit();
        uint32 insertedIndex = _insert(commitment);

        emit Deposit(commitment, insertedIndex, block.timestamp, encryptedMemo);
    }

    /// @notice Withdraw one unspent note to `recipient`, proving membership in zero knowledge.
    /// @dev publicSignals order MUST match the circuit: [root, nullifierHash, recipient, relayer, fee, refund].
    function withdraw(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256 root,
        uint256 nullifierHash,
        address payable recipient,
        address payable relayer,
        uint256 fee,
        uint256 refund
    ) external nonReentrant {
        if (fee > denomination) revert FeeExceedsDenomination();
        if (refund != 0) revert RefundNotSupported();
        if (nullifierHashUsed[nullifierHash]) revert NoteAlreadySpent();
        if (!isKnownRoot(root)) revert UnknownRoot();

        uint256[] memory publicSignals = new uint256[](6);
        publicSignals[0] = root;
        publicSignals[1] = nullifierHash;
        publicSignals[2] = uint256(uint160(address(recipient)));
        publicSignals[3] = uint256(uint160(address(relayer)));
        publicSignals[4] = fee;
        publicSignals[5] = refund;

        if (!verifier.verifyProof(a, b, c, publicSignals)) revert InvalidProof();

        nullifierHashUsed[nullifierHash] = true;

        _pushPayout(recipient, denomination - fee);
        if (fee > 0) _pushPayout(relayer, fee);

        emit Withdrawal(nullifierHash, recipient, relayer, fee);
    }

    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifierHashUsed[nullifierHash];
    }

    /// @dev Take exactly `denomination` of the asset from the depositor (or revert).
    function _pullDeposit() internal virtual;

    /// @dev Send `amount` of the asset to `to` (or revert).
    function _pushPayout(address to, uint256 amount) internal virtual;
}
