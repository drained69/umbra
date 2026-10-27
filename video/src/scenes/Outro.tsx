import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { UmbraMark } from "../components/UmbraMark";
import { font, brand } from "../theme";
import { appear } from "../anim";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const markS = spring({ frame, fps, config: { damping: 200 } });
  const cta = spring({ frame: frame - 40, fps, config: { damping: 200, mass: 0.8 } });
  const ctaScale = interpolate(cta, [0, 1], [0.9, 1]);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
        <div style={{ transform: `scale(${interpolate(markS, [0, 1], [0.8, 1])})`, opacity: appear(frame, 0, 12), filter: "drop-shadow(0 18px 44px rgba(0,0,0,0.4))" }}>
          <UmbraMark size={120} radius={34} />
        </div>
        <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 68, letterSpacing: "-0.04em", color: "#fff", opacity: appear(frame, 8, 14), textAlign: "center", lineHeight: 1.05 }}>
          Pay anyone. <span style={{ color: brand.mint }}>Hide everything.</span>
        </strong>
        <div
          style={{
            opacity: appear(frame, 40, 10),
            transform: `scale(${ctaScale})`,
            marginTop: 8,
            padding: "16px 28px",
            borderRadius: 999,
            background: brand.mint,
            color: brand.brandDeep,
            fontFamily: font.body,
            fontWeight: 700,
            fontSize: 24,
            boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
          }}
        >
          Try it now — umbrav1.up.railway.app
        </div>
        <div style={{ opacity: appear(frame, 60, 12), marginTop: 4, display: "flex", alignItems: "center", gap: 10, fontFamily: font.body, fontSize: 16, color: "#9fc6b2" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: brand.mint }} />
          Portaldot V3 testnet · Portaldot Hacker House 2026
        </div>
      </div>
    </AbsoluteFill>
  );
};
