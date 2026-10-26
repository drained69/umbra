// Two ways in:
//  - "native": the Portaldot Extension (or any polkadot.js-compatible extension). The user's
//    5… account calls Umbra's EVM contracts directly via pallet-revive — no EVM wallet.
//  - "evm": MetaMask / Talisman / SubWallet EVM accounts on the Portaldot EVM.
import { ethers } from "ethers";
import { web3Enable, web3Accounts, web3FromSource } from "@polkadot/extension-dapp";
import { deriveViewingKey, exportViewingKey, importViewingKey } from "@umbra/sdk";
import { CHAIN_ID_HEX, DEPLOYMENT, PORTALDOT_PARAMS } from "./chain";

export type Wallet =
  | { kind: "native"; account: string; label: string; extension: string; signer: any }
  | { kind: "evm"; address: string; signer: ethers.Signer };

export interface NativeAccount {
  address: string;
  name?: string;
  source: string;
}

/** Ask installed extensions for access; Portaldot Extension accounts are listed first. */
export async function listNativeAccounts(): Promise<{ extensions: string[]; accounts: NativeAccount[] }> {
  const exts = await web3Enable("Umbra — confidential POT");
  const extensions = exts.map((e) => e.name);
  const all = await web3Accounts({ ss58Format: 42 });
  const accounts = all
    .map((a) => ({ address: a.address, name: a.meta.name, source: a.meta.source }))
    .sort((a, b) => Number(/portaldot/i.test(b.source)) - Number(/portaldot/i.test(a.source)));
  return { extensions, accounts };
}

export async function connectNative(acc: NativeAccount): Promise<Wallet> {
  const injector = await web3FromSource(acc.source);
  return { kind: "native", account: acc.address, label: acc.name || acc.address, extension: acc.source, signer: injector.signer };
}

export async function connectEvm(): Promise<Wallet> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No EVM wallet found (MetaMask / Talisman / SubWallet)");
  await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
  } catch (e: any) {
    if (e.code === 4902) await eth.request({ method: "wallet_addEthereumChain", params: [PORTALDOT_PARAMS] });
    else throw e;
  }
  const provider = new ethers.BrowserProvider(eth);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(DEPLOYMENT.chainId)) {
    throw new Error(`Switch your EVM wallet to ${DEPLOYMENT.network} before connecting.`);
  }
  const signer = await provider.getSigner();
  return { kind: "evm", address: await signer.getAddress(), signer };
}

/**
 * Viewing keys. EVM wallets: derived from a deterministic ECDSA signature (recoverable).
 * Native wallets: sr25519 signatures are RANDOMIZED, so a signature-derived key would differ
 * every time — instead a random key is generated once per account, kept in this browser,
 * and must be backed up with "Export viewing key".
 */
export async function getViewingKey(w: Wallet): Promise<Uint8Array> {
  if (w.kind === "evm") return deriveViewingKey((m) => w.signer.signMessage(m), DEPLOYMENT.chainId);
  const storageKey = `umbra-vk:${DEPLOYMENT.chainId}:${w.account}`;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return importViewingKey(saved);
  } catch {
    /* storage unavailable: fall through to an ephemeral key */
  }
  const vk = crypto.getRandomValues(new Uint8Array(32));
  try {
    localStorage.setItem(storageKey, exportViewingKey(vk));
  } catch {
    /* ignore */
  }
  return vk;
}

export function restoreViewingKey(w: Wallet, exported: string): Uint8Array {
  const vk = importViewingKey(exported);
  if (w.kind === "native") {
    try {
      localStorage.setItem(`umbra-vk:${DEPLOYMENT.chainId}:${w.account}`, exported.trim());
    } catch {
      /* ignore */
    }
  }
  return vk;
}
