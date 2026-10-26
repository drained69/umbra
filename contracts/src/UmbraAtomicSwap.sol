// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Atomic exchange of one native-token Umbra note and one ERC-20 Umbra note.
/// @dev Both parties sign the exact proofs and output commitments. Fixed pool denominations
///      and the asset pair are public; the original deposits are hidden by each ZK proof.
interface IAtomicSwapPool {
    function token() external view returns (address);
    function denomination() external view returns (uint256);
    function deposit(uint256 commitment, bytes calldata encryptedMemo) external payable;
    function withdraw(
        uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c,
        uint256 root, uint256 nullifierHash, address payable recipient,
        address payable relayer, uint256 fee, uint256 refund
    ) external;
}

contract UmbraAtomicSwap {
    struct SpendProof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
        uint256 root;
        uint256 nullifierHash;
    }

    struct Order {
        bytes32 swapId;
        uint64 deadline;
        SpendProof nativeProof;
        SpendProof tokenProof;
        uint256 nativeOutput;
        uint256 tokenOutput;
        bytes nativeMemo;
        bytes tokenMemo;
        address nativeSigner;
        address tokenSigner;
    }

    IAtomicSwapPool public immutable nativePool;
    IAtomicSwapPool public immutable tokenPool;
    address public immutable token;
    uint256 public immutable nativeDenomination;
    uint256 public immutable tokenDenomination;
    mapping(bytes32 => bool) public usedSwapId;
    uint256 private _locked = 1;

    event Swapped(bytes32 indexed swapId, uint256 nativeOutput, uint256 tokenOutput);

    error InvalidConfig();
    error InvalidOrder();
    error Expired();
    error InvalidSignature();
    error Replay();
    error UnexpectedBalance();
    error TokenCallFailed();
    error AlreadyLocked();

    constructor(IAtomicSwapPool nativePool_, IAtomicSwapPool tokenPool_) {
        if (address(nativePool_) == address(0) || address(tokenPool_) == address(0)) revert InvalidConfig();
        if (nativePool_.token() != address(0)) revert InvalidConfig();
        address asset = tokenPool_.token();
        if (asset == address(0)) revert InvalidConfig();
        uint256 nativeAmount = nativePool_.denomination();
        uint256 tokenAmount = tokenPool_.denomination();
        if (nativeAmount == 0 || tokenAmount == 0) revert InvalidConfig();
        nativePool = nativePool_;
        tokenPool = tokenPool_;
        token = asset;
        nativeDenomination = nativeAmount;
        tokenDenomination = tokenAmount;
    }

    receive() external payable {
        if (msg.sender != address(nativePool) || _locked != 2) revert UnexpectedBalance();
    }

    /// @notice The proof's zero-fee relayer must equal the low 160 bits of this digest.
    /// @dev This binds both ZK proofs to the outputs and terms without a circular proof hash.
    function orderDigest(Order calldata order) public view returns (bytes32) {
        bytes32 spendIds = keccak256(abi.encode(
            order.nativeProof.root, order.nativeProof.nullifierHash,
            order.tokenProof.root, order.tokenProof.nullifierHash
        ));
        bytes32 outputs = keccak256(abi.encode(
            order.nativeOutput, order.tokenOutput, keccak256(order.nativeMemo), keccak256(order.tokenMemo)
        ));
        return keccak256(abi.encode(
            "UMBRA_ATOMIC_SWAP_V1", block.chainid, address(this), order.swapId, order.deadline, spendIds, outputs,
            order.nativeSigner, order.tokenSigner
        ));
    }

    /// @param order Exact proofs, output notes, expiry, and ephemeral owner signers.
    /// @dev Both proofs must use this contract as recipient and orderTag(order) as relayer.
    ///      Submit through a private transaction path: anyone seeing a proof can still submit
    ///      a standalone zero-fee withdrawal to this contract and strand that note's funds.
    function swap(Order calldata order, bytes calldata nativeSignature, bytes calldata tokenSignature) external {
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        if (order.swapId == bytes32(0) || order.nativeOutput == 0 || order.tokenOutput == 0 || order.nativeSigner == address(0) || order.tokenSigner == address(0) || order.nativeSigner == order.tokenSigner) revert InvalidOrder();
        if (block.timestamp > order.deadline) revert Expired();
        if (usedSwapId[order.swapId]) revert Replay();
        bytes32 digest = orderDigest(order);
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (_recover(signed, nativeSignature) != order.nativeSigner || _recover(signed, tokenSignature) != order.tokenSigner) revert InvalidSignature();
        usedSwapId[order.swapId] = true;

        address payable tag = payable(address(uint160(uint256(digest))));

        uint256 nativeBefore = address(this).balance;
        uint256 tokenBefore = _balance();
        nativePool.withdraw(order.nativeProof.a, order.nativeProof.b, order.nativeProof.c, order.nativeProof.root, order.nativeProof.nullifierHash, payable(address(this)), tag, 0, 0);
        tokenPool.withdraw(order.tokenProof.a, order.tokenProof.b, order.tokenProof.c, order.tokenProof.root, order.tokenProof.nullifierHash, payable(address(this)), tag, 0, 0);
        if (address(this).balance - nativeBefore != nativeDenomination || _balance() - tokenBefore != tokenDenomination) revert UnexpectedBalance();

        nativePool.deposit{value: nativeDenomination}(order.nativeOutput, order.nativeMemo);
        _call(abi.encodeWithSelector(0x095ea7b3, address(tokenPool), tokenDenomination)); // approve
        tokenPool.deposit(order.tokenOutput, order.tokenMemo);
        if (address(this).balance != nativeBefore || _balance() != tokenBefore) revert UnexpectedBalance();
        emit Swapped(order.swapId, order.nativeOutput, order.tokenOutput);
        _locked = 1;
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address signer) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    function _balance() private view returns (uint256) {
        (bool ok, bytes memory out) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || out.length < 32) revert TokenCallFailed();
        return abi.decode(out, (uint256));
    }

    function _call(bytes memory data) private {
        (bool ok, bytes memory out) = token.call(data);
        if (!ok || (out.length != 0 && (out.length < 32 || !abi.decode(out, (bool))))) revert TokenCallFailed();
    }
}
