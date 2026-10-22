// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerkleTreeWithHistory} from "./MerkleTreeWithHistory.sol";
import {IHasher} from "./interfaces/IHasher.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @title UmbraPool
/// @notice A single fixed-denomination shielded pool for native tPOT on Portaldot V3.
///         Units: the EVM layer (pallet-revive) exposes native value scaled to 18 decimals
///         (native POT has 14; ratio 10^4), so `denomination` is in 18-decimal EVM wei.
///         Deposits add a note commitment to the Merkle tree. Withdrawals prove, in
///         zero knowledge, membership of an unspent note WITHOUT revealing which one —
///         breaking the on-chain link between deposit and withdrawal.
///
/// @dev Cross-VM design: `verifier` may be the on-chain snarkjs Groth16 `Verifier.sol`
///      OR the `UmbraCoprocessorBridge` that forwards the pairing check to the ink!/WASM
///      coprocessor. The pool does not care which — that indifference is the whole point:
///      it is the first app to treat Portaldot's second VM as a pluggable ZK coprocessor.
///
///      Relayer support: a withdrawal can be submitted by a relayer that pays gas and
///      takes `fee` out of the withdrawn amount, so the recipient can be a brand-new
///      address that has never held gas — essential for real unlinkability.
contract UmbraPool is MerkleTreeWithHistory {
    IVerifier public immutable verifier;
    uint256 public immutable denomination;

    mapping(uint256 => bool) public nullifierHashUsed;
    mapping(uint256 => bool) public commitments;

    // --- reentrancy guard (minimal, no external dep) ---
    uint256 private _locked = 1;

    error AlreadyLocked();
    error InvalidDenomination();
    error CommitmentExists();
    error UnknownRoot();
    error NoteAlreadySpent();
    error FeeExceedsDenomination();
    error InvalidProof();
    error RefundNotSupported();
    error PaymentFailed();

    /// @param nullifierHash the spent note's nullifier hash (public, so it can be checked unique)
    /// @param to the recipient of the shielded funds
    /// @param relayer the address that submitted the tx (==to for self-withdrawals)
    /// @param fee amount paid to the relayer out of the denomination
    event Withdrawal(uint256 indexed nullifierHash, address indexed to, address indexed relayer, uint256 fee);

    /// @param commitment the note commitment inserted
    /// @param leafIndex its position in the tree (for SDK path reconstruction)
    /// @param timestamp block time
    /// @param encryptedMemo optional ciphertext, encrypted to a viewing key, letting the
    ///        owner (or an auditor they share the key with) reconstruct this action —
    ///        privacy WITH optional, user-controlled selective disclosure.
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

    /// @notice Shield `denomination` native tPOT behind `commitment = Poseidon(nullifier, secret)`.
    /// @param commitment the note commitment (computed client-side; contract never sees the preimage)
    /// @param encryptedMemo optional viewing-key ciphertext (pass empty bytes to skip)
    function deposit(uint256 commitment, bytes calldata encryptedMemo) external payable nonReentrant {
        if (msg.value != denomination) revert InvalidDenomination();
        if (commitments[commitment]) revert CommitmentExists();

        uint32 insertedIndex = _insert(commitment);
        commitments[commitment] = true;

        emit Deposit(commitment, insertedIndex, block.timestamp, encryptedMemo);
    }

    /// @notice Withdraw one unspent note to `recipient`, proving membership in zero knowledge.
    /// @dev `publicSignals` order is fixed and MUST match the circom circuit + verifier:
    ///      [root, nullifierHash, recipient, relayer, fee, refund].
    ///      Binding recipient/relayer/fee into the proof stops a malicious relayer from
    ///      redirecting funds or inflating the fee.
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
        if (refund != 0) revert RefundNotSupported(); // native-token pool: no separate refund leg
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

        uint256 amount = denomination - fee;
        _pay(recipient, amount);
        if (fee > 0) _pay(relayer, fee);

        emit Withdrawal(nullifierHash, recipient, relayer, fee);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert PaymentFailed();
    }

    /// @notice Convenience view used by the SDK/relayer to decide if a note is spendable.
    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifierHashUsed[nullifierHash];
    }
}
