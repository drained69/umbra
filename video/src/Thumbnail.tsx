import React from "react";
import { AbsoluteFill } from "remotion";
import { UmbraMark } from "./components/UmbraMark";
import { BalanceTile, StatusLine } from "./components/ui";
import { brand, font, heroGradient, light as L, radius } from "./theme";
import "./fonts";

// YouTube custom thumbnail (1280×720). Big type that survives a phone-sized tile, plus a real
// slice of the app: the private balance and the relayer's "Sent privately" confirmation.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: heroGradient, fontFamily: font.body, overflow: "hidden" }}>
    <style>{`*,*::before,*::after{box-sizing:border-box}`}</style>
    <AbsoluteFill style={{ background: "radial-gradient(55% 60% at 78% 40%, rgba(143,214,177,0.22), transparent 70%)" }} />

    <div style={{ position: "absolute", left: 70, top: 64, display: "flex", alignItems: "center", gap: 16 }}>
      <UmbraMark size={64} radius={18} />
      <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 48, letterSpacing: "-0.05em", color: "#fff" }}>
        umbra<span style={{ color: brand.mint }}>.</span>
      </strong>
    </div>

    <div style={{ position: "absolute", left: 70, top: 176, width: 820 }}>
      <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 88, whiteSpace: "nowrap", lineHeight: 0.98, letterSpacing: "-0.045em", color: "#fff" }}>
        Pay anyone.
        <br />
        <span style={{ color: brand.mint }}>Hide everything.</span>
      </div>
      <div style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 12, padding: "12px 20px", borderRadius: 999, background: "rgba(6,22,16,0.6)", border: "1px solid rgba(143,214,177,0.35)", color: "#d9f2e4", fontSize: 26, fontWeight: 700 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: brand.mint }} />
        Zero-knowledge payments on Portaldot
      </div>
    </div>

    <div
      style={{
        position: "absolute",
        right: 48,
        top: 372,
        width: 460,
        padding: 26,
        borderRadius: radius.xl,
        background: L.surface,
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        transform: "rotate(-3deg)",
        zIndex: 1,
      }}
    >
      <div style={{ fontFamily: font.display, fontWeight: 700, fontSize: 22, color: L.ink, marginBottom: 14 }}>Private account</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <BalanceTile label="tPOT balance" amount="37.4375" unit="tPOT" highlight />
        <BalanceTile label="pUSD balance" amount="24.9842" unit="pUSD" />
      </div>
      <StatusLine kind="ok" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>
        <span style={{ flex: "none", display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", background: L.accent, color: "#fff", fontSize: 13 }}>✓</span>
        <span>Sent privately · relayed in block <span style={{ fontFamily: font.mono, fontSize: 13 }}>0x4c1e…7a90</span></span>
      </StatusLine>
    </div>
  </AbsoluteFill>
);
