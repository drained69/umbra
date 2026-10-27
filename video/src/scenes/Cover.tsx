import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { UmbraMark } from "../components/UmbraMark";
import { font, brand } from "../theme";

// Frame 0 is already the finished cover (logo centred, tagline below) — platforms grab it
// as the thumbnail. Motion after frame 0 is a gentle breathe + an expanding ring.
export const Cover: React.FC = () => {
  const frame = useCurrentFrame();
  const breathe = 1 + Math.sin(frame / 34) * 0.012;
  const ring = interpolate(frame, [10, 90], [0.7, 1.25], { extrapolateRight: "clamp" });
  const ringO = interpolate(frame, [10, 90], [0.35, 0], { extrapolateRight: "clamp" });
  const divider = interpolate(frame, [18, 48], [0, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        {/* expanding halo */}
        <div
          style={{
            position: "absolute",
            top: 84 - 160,
            left: "50%",
            marginLeft: -160,
            width: 320,
            height: 320,
            borderRadius: "50%",
            border: `1.5px solid ${brand.mint}`,
            opacity: ringO,
            transform: `scale(${ring})`,
          }}
        />
        <div style={{ transform: `scale(${breathe})`, filter: "drop-shadow(0 20px 50px rgba(0,0,0,0.4))" }}>
          <UmbraMark size={168} radius={48} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 88, letterSpacing: "-0.05em", color: "#ffffff", lineHeight: 1 }}>
            umbra<span style={{ color: brand.mint }}>.</span>
          </strong>
          <div style={{ width: divider, height: 2, background: brand.mint, opacity: 0.8, borderRadius: 2 }} />
          <p style={{ margin: 0, fontFamily: font.body, fontSize: 30, color: "#cdebdc", letterSpacing: "0.01em" }}>Private payments on Portaldot</p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
