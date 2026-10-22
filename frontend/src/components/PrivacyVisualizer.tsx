// Side-by-side "what the chain sees" vs "what only you know" — the core demo visual.
interface Props {
  title: string;
  publicRows: { k: string; v: string }[];
  privateRows: { k: string; v: string }[];
}
export default function PrivacyVisualizer({ title, publicRows, privateRows }: Props) {
  return (
    <div>
      <h3 style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>{title}</h3>
      <div className="leak">
        <div className="col public">
          <h3>🌐 On-chain (everyone sees)</h3>
          {publicRows.map((r, i) => (
            <div className="kv" key={i}>
              <b>{r.k}:</b> {r.v}
            </div>
          ))}
        </div>
        <div className="col private">
          <h3>🔒 Your secret (never on-chain)</h3>
          {privateRows.map((r, i) => (
            <div className="kv" key={i}>
              <b>{r.k}:</b> {r.v}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
