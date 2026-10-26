import { ethers } from "ethers";
import { DEPLOYMENT, short } from "../lib/chain";

interface Props { onBack: () => void }

export default function DeploymentSummary({ onBack }: Props) {
  const c = DEPLOYMENT.contracts;
  const rows: [string, string][] = [
    ["Poseidon hasher", c.poseidon],
    ["Withdrawal verifier", c.withdrawVerifier],
    ["100 tPOT pool", c.pools["100"]],
    ["1,000 tPOT pool", c.pools["1000"]],
    ["100 pUSD pool", c.tokens.pUSD.pools["100"]],
    ["1,000 pUSD pool", c.tokens.pUSD.pools["1000"]],
    ["Private transfer verifier", c.transactionVerifier],
    ["Private transfer pool", c.shieldedPool],
  ];

  return (
    <div className="card deployment-summary">
      <div className="summary-heading"><div className="summary-mark">✓</div><div><span className="eyebrow">VERIFIED DEPLOYMENT</span><h2>All contracts are live</h2><p className="hint">Portaldot V3 testnet · deployed from {short(DEPLOYMENT.deployer.native)}</p></div></div>
      <p>Eight contracts are deployed, with the pool wiring and real proof verification checked on chain. The app is configured to use these addresses.</p>
      <div className="contract-list">
        {rows.map(([label, address]) => <div key={label} className="contract-row"><span>{label}</span><button title={`Copy ${label} address`} onClick={() => navigator.clipboard.writeText(ethers.getAddress(address))} className="mono">{short(address)} <span aria-hidden="true">⧉</span></button></div>)}
      </div>
      <div className="summary-actions"><button className="primary" onClick={onBack}>Go to Umbra</button><button onClick={() => navigator.clipboard.writeText(JSON.stringify(DEPLOYMENT, null, 2))}>Copy deployment details</button></div>
    </div>
  );
}
