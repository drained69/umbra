// Human-readable ABIs for the Umbra contracts (ethers v6 accepts these directly).

export const POOL_ABI = [
  "function denomination() view returns (uint256)",
  "function token() view returns (address)",
  "function deposit(uint256 commitment, bytes encryptedMemo) payable",
  "function withdraw(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund)",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function getLastRoot() view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp, bytes encryptedMemo)",
  "event Withdrawal(uint256 indexed nullifierHash, address indexed to, address indexed relayer, uint256 fee)",
];

export const FACTORY_ABI = [
  "function poolForDenomination(uint256) view returns (address)",
  "function poolFor(address asset, uint256 denomination) view returns (address)",
  "function allPools() view returns (address[])",
];

export const POOL_ERRORS_ABI = [
  "error InvalidDenomination()",
  "error CommitmentExists()",
  "error UnknownRoot()",
  "error NoteAlreadySpent()",
  "error FeeExceedsDenomination()",
  "error InvalidProof()",
  "error NativeValueNotAccepted()",
  "error TokenTransferFailed()",
  "error UnsupportedToken()",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
