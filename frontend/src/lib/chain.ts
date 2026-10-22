import { ethers } from "ethers";
import deployment from "../config/deployment.json";

export const DEPLOYMENT = deployment;
export const CHAIN_ID_HEX = "0x" + deployment.chainId.toString(16);

export const PORTALDOT_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Portaldot V3 Testnet",
  nativeCurrency: { name: "Test POT", symbol: "tPOT", decimals: 18 }, // MetaMask display only
  rpcUrls: [deployment.rpc],
  blockExplorerUrls: ["https://node-console.portaldot.dev/"],
};

export async function connectWallet(): Promise<{ provider: ethers.BrowserProvider; signer: ethers.Signer; address: string }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");
  await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e: any) {
    if (e.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [PORTALDOT_PARAMS] });
    }
  }
  const provider = new ethers.BrowserProvider(eth);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

/**
 * On-chain (EVM) amounts are 18-decimal: pallet-revive scales native 14-dec POT by 10^4.
 * `DEPLOYMENT.decimals` is the EVM unit (18). Never format EVM values with 14.
 */
export function formatPOT(wei: bigint): string {
  return ethers.formatUnits(wei, DEPLOYMENT.decimals);
}
export function parsePOT(amount: string): bigint {
  return ethers.parseUnits(amount, DEPLOYMENT.decimals);
}

export function short(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}
