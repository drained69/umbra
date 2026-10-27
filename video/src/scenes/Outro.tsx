import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { UmbraMark } from "../components/UmbraMark";
import { font, brand } from "../theme";
import { appear } from "../anim";

// Under the hood: each fact is stated in the README (proof system, on-chain verification via
// BN254 precompiles, Poseidon/Merkle/nullifier notes, relayer submission, live testnet).
const FACTS: [string, string][] = [
  ["Groth16 zero-knowledge proofs", "generated in your browser"],
  ["Verified on chain", "Portaldot V3, BN254 precompiles"],
  ["Poseidon notes in a Merkle tree", "nullifiers stop double spends"],
  ["Relayer-submitted", "your wallet never signs a payment"],
];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const portrait = width < 1200;
  const markS = spring({ frame, fps, config: { damping: 200 } });
  const cta = spring({ frame: frame - 76, fps, config: { damping: 200, mass: 0.8 } });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 60 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, transform: `scale(${interpolate(markS, [0, 1], [0.85, 1])})`, opacity: appear(frame, 0, 10) }}>
          <UmbraMark size={92} radius={26} />
          <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 72, letterSpacing: "-0.05em", color: "#fff", lineHeight: 1 }}>
            umbra<span style={{ color: brand.mint }}>.</span>
          </strong>
        </div>
        <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: portrait ? 64 : 76, letterSpacing: "-0.04em", color: "#fff", opacity: appear(frame, 8, 12), textAlign: "center", lineHeight: 1.05 }}>
          Pay anyone. <span style={{ color: brand.mint }}>Hide everything.</span>
        </strong>

        <div style={{ display: "grid", gridTemplateColumns: portrait ? "1fr" : "repeat(2, 560px)", gap: 14, marginTop: 10 }}>
          {FACTS.map(([title, detail], i) => {
            const at = 26 + i * 9;
            return (
              <div
                key={title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "16px 20px",
                  borderRadius: 18,
                  background: "rgba(6,22,16,0.55)",
                  border: "1px solid rgba(143,214,177,0.22)",
                  opacity: appear(frame, at, 10),
                  transform: `translateY(${(1 - appear(frame, at, 12)) * 14}px)`,
                }}
              >
                <span style={{ flex: "none", display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: brand.mint, color: brand.brandDeep, fontWeight: 800, fontSize: 16 }}>✓</span>
                <div>
                  <div style={{ color: "#fff", fontFamily: font.display, fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em" }}>{title}</div>
                  <div style={{ color: "#9fc6b2", fontFamily: font.body, fontSize: 17 }}>{detail}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            opacity: appear(frame, 76, 10),
            transform: `scale(${interpolate(cta, [0, 1], [0.9, 1])})`,
            marginTop: 12,
            padding: "18px 32px",
            borderRadius: 999,
            background: brand.mint,
            color: brand.brandDeep,
            fontFamily: font.body,
            fontWeight: 800,
            fontSize: 28,
            boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
          }}
        >
          Try it now — umbrav1.up.railway.app
        </div>
        <div style={{ opacity: appear(frame, 92, 12), display: "flex", alignItems: "center", gap: 10, fontFamily: font.body, fontSize: 18, color: "#9fc6b2" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: brand.mint }} />
          Live on Portaldot V3 testnet · Portaldot Hacker House 2026
        </div>
      </div>
    </AbsoluteFill>
  );
};
