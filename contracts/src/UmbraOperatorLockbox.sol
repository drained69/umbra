// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Source-chain half of an operator-trusted testnet bridge into Umbra.
/// @dev The operator is trusted to credit the destination before settling and to sign refunds
///      only for undelivered messages. There is no cross-chain proof in this prototype.
contract UmbraOperatorLockbox {
    address public immutable token;
    address public immutable operator;
    uint256 public immutable destinationChainId;
    address public destinationInbox;
    uint256 public immutable denomination;
    uint64 public immutable refundDelay;

    uint256 public nextNonce;
    uint256 private _locked = 1;

    enum State { None, Pending, Settled, Refunded }
    struct Lock {
        address depositor;
        uint256 commitment;
        uint64 createdAt;
        State state;
    }
    mapping(uint256 => Lock) public locks;

    event Locked(uint256 indexed nonce, address indexed depositor, uint256 indexed commitment, uint256 sourceChainId, uint256 destinationChainId, address destinationInbox, address sourceToken, uint256 amount, bytes encryptedMemo);
    event Settled(uint256 indexed nonce, address indexed operator);
    event Refunded(uint256 indexed nonce, address indexed depositor);
    event DestinationConfigured(address indexed inbox);

    error InvalidConfig();
    error NotOperator();
    error NotDepositor();
    error WrongState();
    error TooEarly();
    error InvalidRefundSignature();
    error TokenCallFailed();
    error InvalidCollateral();
    error AlreadyLocked();

    constructor(address token_, address operator_, uint256 destinationChainId_, uint256 denomination_, uint64 refundDelay_) {
        if (token_ == address(0) || operator_ == address(0) || destinationChainId_ == 0 || denomination_ == 0 || refundDelay_ == 0) revert InvalidConfig();
        token = token_;
        operator = operator_;
        destinationChainId = destinationChainId_;
        denomination = denomination_;
        refundDelay = refundDelay_;
    }

    /// @notice Complete the cross-chain route once the destination inbox has been deployed.
    function configureDestination(address inbox_) external {
        if (msg.sender != operator) revert NotOperator();
        if (inbox_ == address(0) || destinationInbox != address(0) || nextNonce != 0) revert InvalidConfig();
        destinationInbox = inbox_;
        emit DestinationConfigured(inbox_);
    }

    modifier nonReentrant() {
        if (_locked != 1) revert AlreadyLocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    function lock(uint256 commitment, bytes calldata encryptedMemo) external nonReentrant returns (uint256 nonce) {
        if (destinationInbox == address(0)) revert InvalidConfig();
        nonce = ++nextNonce;
        locks[nonce] = Lock(msg.sender, commitment, uint64(block.timestamp), State.Pending);
        uint256 beforeBalance = _balance(address(this));
        _call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), denomination));
        if (_balance(address(this)) - beforeBalance != denomination) revert InvalidCollateral();
        emit Locked(nonce, msg.sender, commitment, block.chainid, destinationChainId, destinationInbox, token, denomination, encryptedMemo);
    }

    /// @notice Operator acknowledges destination credit and receives source collateral.
    /// @dev The operator must not call this until destination finality; the contract cannot verify it.
    function settle(uint256 nonce) external nonReentrant {
        if (msg.sender != operator) revert NotOperator();
        Lock storage item = locks[nonce];
        if (item.state != State.Pending) revert WrongState();
        item.state = State.Settled;
        _call(abi.encodeWithSelector(0xa9059cbb, operator, denomination));
        emit Settled(nonce, operator);
    }

    /// @notice Refund requires an operator-signed non-delivery certificate after the delay.
    /// @dev The operator must never sign a refund for a delivered message.
    function refund(uint256 nonce, bytes calldata operatorSignature) external nonReentrant {
        Lock storage item = locks[nonce];
        if (msg.sender != item.depositor) revert NotDepositor();
        if (item.state != State.Pending) revert WrongState();
        if (block.timestamp < uint256(item.createdAt) + refundDelay) revert TooEarly();
        bytes32 digest = refundDigest(nonce);
        bytes32 signed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (_recover(signed, operatorSignature) != operator) revert InvalidRefundSignature();
        item.state = State.Refunded;
        _call(abi.encodeWithSelector(0xa9059cbb, item.depositor, denomination));
        emit Refunded(nonce, item.depositor);
    }

    function refundDigest(uint256 nonce) public view returns (bytes32) {
        Lock storage item = locks[nonce];
        return keccak256(abi.encode("UMBRA_BRIDGE_REFUND_V1", block.chainid, address(this), destinationChainId, destinationInbox, nonce, item.depositor, item.commitment));
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
        // EIP-2 low-s check prevents signature malleability.
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return address(0);
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
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
