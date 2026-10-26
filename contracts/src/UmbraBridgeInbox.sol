// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Adapter for a bridge that delivers finalized messages AND their backing tokens.
/// @dev This contract does not verify source-chain finality. Its immutable messenger must do so.
///      One instance serves one source, asset, and fixed-denomination UmbraTokenPool.
interface IInboxPool {
    function token() external view returns (address);
    function denomination() external view returns (uint256);
    function deposit(uint256 commitment, bytes calldata encryptedMemo) external;
}

contract UmbraBridgeInbox {
    address public immutable messenger;
    uint256 public immutable sourceChainId;
    bytes32 public immutable sourceSender;
    address public immutable token;
    IInboxPool public immutable pool;
    uint256 public immutable denomination;

    mapping(bytes32 => bool) public consumed;
    uint256 private _locked = 1;

    event BridgeNoteCredited(bytes32 indexed messageId, uint256 indexed commitment, uint256 sourceNonce);

    error NotMessenger();
    error WrongSource();
    error MessageAlreadyUsed();
    error InvalidConfig();
    error InvalidCollateral();
    error TokenCallFailed();
    error AlreadyLocked();

    constructor(address messenger_, uint256 sourceChainId_, bytes32 sourceSender_, address token_, IInboxPool pool_) {
        if (messenger_ == address(0) || sourceChainId_ == 0 || sourceSender_ == bytes32(0) || token_ == address(0) || address(pool_) == address(0)) revert InvalidConfig();
        if (pool_.token() != token_) revert InvalidConfig();
        uint256 denom = pool_.denomination();
        if (denom == 0) revert InvalidConfig();
        messenger = messenger_;
        sourceChainId = sourceChainId_;
        sourceSender = sourceSender_;
        token = token_;
        pool = pool_;
        denomination = denom;
    }

    function messageId(uint256 sourceNonce) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), sourceChainId, sourceSender, sourceNonce, token, denomination));
    }

    /// @param sender The source-chain contract authenticated by the messenger.
    /// @param nonce Unique source-chain message nonce authenticated by the messenger.
    /// @param commitment The receiver-generated note commitment. The inbox never sees its secret.
    function deliver(uint256 chainId, bytes32 sender, uint256 nonce, uint256 commitment, bytes calldata encryptedMemo) external {
        if (msg.sender != messenger) revert NotMessenger();
        if (chainId != sourceChainId || sender != sourceSender) revert WrongSource();
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        bytes32 id = messageId(nonce);
        if (consumed[id]) revert MessageAlreadyUsed();
        consumed[id] = true;

        uint256 beforeBalance = _balance(address(this));
        _call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), denomination));
        if (_balance(address(this)) - beforeBalance != denomination) revert InvalidCollateral();
        _call(abi.encodeWithSelector(0x095ea7b3, address(pool), denomination)); // approve
        pool.deposit(commitment, encryptedMemo);
        if (_balance(address(this)) != beforeBalance) revert InvalidCollateral();

        emit BridgeNoteCredited(id, commitment, nonce);
        _locked = 1;
    }

    function _balance(address account) private view returns (uint256) {
        (bool ok, bytes memory out) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!ok || out.length < 32) revert TokenCallFailed();
        return abi.decode(out, (uint256));
    }

    function _call(bytes memory data) private {
        (bool ok, bytes memory out) = token.call(data);
        if (!ok || (out.length != 0 && (out.length < 32 || !abi.decode(out, (bool))))) revert TokenCallFailed();
    }
}
