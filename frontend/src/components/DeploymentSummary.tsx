import { ethers } from "ethers";
import { CROSS_VM, DEPLOYMENT, NATIVE, short } from "../lib/chain";

interface Props { onBack: () => void; onSetUpCrossVm: () => void }

export default function DeploymentSummary({ onBack, onSetUpCrossVm }: Props) {
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
      <span className="eyebrow" style={{ display: "block", marginTop: 18 }}>WASM VERIFICATION</span>
      {CROSS_VM ? (
        <div className="contract-list">
          {([
            ["Groth16 coprocessor (WASM)", CROSS_VM.coprocessor],
            ["Coprocessor bridge (EVM)", CROSS_VM.bridge],
            ...Object.entries(CROSS_VM.pools).map(([d, a]) => [`${d} ${NATIVE} pool (WASM-verified)`, a]),
          ] as [string, string][]).map(([label, address]) => <div key={label} className="contract-row"><span>{label}</span><button title={`Copy ${label} address`} onClick={() => navigator.clipboard.writeText(address)} className="mono">{short(address)} <span aria-hidden="true">⧉</span></button></div>)}
        </div>
      ) : (
        <p className="hint">Not deployed. These pools verify proofs on the EVM. Deploy the ink! coprocessor to add a pool whose proofs are checked in Portaldot's WASM VM. <button className="text-button" onClick={onSetUpCrossVm}>Set up WASM verification ↗</button></p>
      )}
      <div className="summary-actions"><button className="primary" onClick={onBack}>Go to Umbra</button><button onClick={() => navigator.clipboard.writeText(JSON.stringify(DEPLOYMENT, null, 2))}>Copy deployment details</button></div>
    </div>
  );
}
