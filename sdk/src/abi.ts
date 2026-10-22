// Human-readable ABIs for the Umbra contracts (ethers v6 accepts these directly).

export const POOL_ABI = [
  "function denomination() view returns (uint256)",
  "function deposit(uint256 commitment, bytes encryptedMemo) payable",
  "function withdraw(uint256[2] a,uint256[2][2] b,uint256[2] c,uint256 root,uint256 nullifierHash,address recipient,address relayer,uint256 fee,uint256 refund) payable",
  "function isSpent(uint256 nullifierHash) view returns (bool)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function getLastRoot() view returns (uint256)",
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp, bytes encryptedMemo)",
  "event Withdrawal(uint256 indexed nullifierHash, address indexed to, address indexed relayer, uint256 fee)",
];

export const FACTORY_ABI = [
  "function poolForDenomination(uint256) view returns (address)",
  "function allDenominations() view returns (uint256[])",
];
