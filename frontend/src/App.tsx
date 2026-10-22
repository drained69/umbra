import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { UmbraPoolClient, deriveViewingKey } from "@umbra/sdk";
import { connectWallet, DEPLOYMENT, parsePOT, short } from "./lib/chain";
import DepositPanel from "./components/DepositPanel";
import WithdrawPanel from "./components/WithdrawPanel";
import AuditorPanel from "./components/AuditorPanel";

type Tab = "deposit" | "withdraw" | "auditor";
const RELAYER_URL = (import.meta as any).env?.VITE_RELAYER_URL || "http://localhost:8787";

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [tab, setTab] = useState<Tab>("deposit");
  const [viewingKey, setViewingKey] = useState<Uint8Array | null>(null);

  const pools = DEPLOYMENT.contracts.pools as Record<string, string>;
  const denomLabels = Object.keys(pools);
  const [denom, setDenom] = useState<string>(denomLabels[0] || "1");
  const configured = denomLabels.length > 0 && pools[denom] && pools[denom] !== ethers.ZeroAddress;

  const client = useMemo(() => {
    if (!signer || !configured) return null;
    return new UmbraPoolClient(pools[denom], signer, { deployBlock: (DEPLOYMENT as any).deployBlock ?? 0 });
  }, [signer, denom, configured]);

  async function connect() {
    const w = await connectWallet();
    setAddress(w.address);
    setSigner(w.signer);
    setProvider(w.provider);
  }

  async function makeViewingKey() {
    if (!signer) return;
    const vk = await deriveViewingKey((m) => signer.signMessage(m), DEPLOYMENT.chainId);
    setViewingKey(vk);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1>Umbra</h1>
            <div className="sub">Confidential tPOT · ZK-verified in Portaldot's WASM coprocessor</div>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="pill">Portaldot V3 · chain {DEPLOYMENT.chainId}</span>
          {address ? (
            <span className="pill">{short(address)}</span>
          ) : (
            <button className="primary" onClick={connect}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {!configured && (
        <div className="status info">
          No pools configured yet. Run <span className="mono">cd scripts &amp;&amp; npm i &amp;&amp; npm run deploy</span>{" "}
          to deploy to Portaldot V3 testnet — the app reads addresses from{" "}
          <span className="mono">frontend/src/config/deployment.json</span> automatically.
        </div>
      )}

      {address && (
        <>
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div className="denoms">
              {denomLabels.map((d) => (
                <div key={d} className={`chip ${d === denom ? "active" : ""}`} onClick={() => setDenom(d)}>
                  {d} tPOT
                </div>
              ))}
            </div>
            <button className="ghost" onClick={makeViewingKey}>
              {viewingKey ? "✓ viewing key ready" : "Derive viewing key"}
            </button>
          </div>

          <div className="tabs">
            <button className={tab === "deposit" ? "active" : ""} onClick={() => setTab("deposit")}>
              Deposit
            </button>
            <button className={tab === "withdraw" ? "active" : ""} onClick={() => setTab("withdraw")}>
              Withdraw
            </button>
            <button className={tab === "auditor" ? "active" : ""} onClick={() => setTab("auditor")}>
              Viewing key / Audit
            </button>
          </div>

          {client && tab === "deposit" && (
            <DepositPanel client={client} denomLabel={denom} denomWei={parsePOT(denom)} viewingKey={viewingKey} />
          )}
          {client && signer && tab === "withdraw" && (
            <WithdrawPanel client={client} signer={signer} relayerUrl={RELAYER_URL} />
          )}
          {client && tab === "auditor" && (
            <AuditorPanel client={client} myViewingKey={viewingKey} denomLabel={denom} />
          )}
        </>
      )}

      <div className="footer">
        Umbra · Portaldot Hacker House 2026 · EVM asset layer + WASM ZK coprocessor on one chain.
        <br />
        On-chain amounts use {DEPLOYMENT.decimals}-decimal EVM units (native POT is 14-dec, scaled ×10⁴).
      </div>
    </div>
  );
}
