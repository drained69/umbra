import React from "react";
import { useCurrentFrame } from "remotion";
import { BrowserFrame } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { PrivacyMeter } from "../components/ui";
import { light as L, font, brand, heroGradient, radius } from "../theme";
import { countUp } from "../anim";
import { useApp } from "../components/context";

const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const narrow = useApp().orientation === "portrait";
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,1.1fr) minmax(0,0.9fr)",
        alignItems: "center",
        gap: 24,
        padding: narrow ? "40px 34px" : "48px 52px",
        borderRadius: radius.xl,
        background: heroGradient,
        color: "#eaf6ef",
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid rgba(217,242,228,0.25)", borderRadius: 999, color: "#cdebdc", fontSize: 13, fontWeight: 600, fontFamily: font.body }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: brand.mint, boxShadow: "0 0 0 4px rgba(143,214,177,0.18)" }} />
          Private payments on Portaldot · Testnet
        </span>
        <h1 style={{ margin: "18px 0 14px", color: "#fff", fontFamily: font.display, fontSize: 52, fontWeight: 800, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
          Your money.<br />
          <em style={{ fontStyle: "normal", color: brand.mint }}>Your privacy.</em>
        </h1>
        <p style={{ margin: "0 0 24px", maxWidth: 470, color: "#c7e3d4", fontSize: 17, lineHeight: 1.55, fontFamily: font.body }}>
          Pay, request, split bills and swap on Portaldot, publicly or privately. You choose what is shared, and you see it before anything is sent.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ padding: "13px 20px", borderRadius: radius.sm, background: brand.mint, color: brand.brandDeep, fontWeight: 600, fontSize: 15, fontFamily: font.body }}>Connect wallet</div>
          <div style={{ padding: "13px 20px", borderRadius: radius.sm, border: "1px solid rgba(217,242,228,0.35)", color: "#eaf6ef", fontWeight: 600, fontSize: 15, fontFamily: font.body }}>How it works</div>
        </div>
        <small style={{ display: "block", marginTop: 18, color: "#9fc6b2", fontSize: 13, fontFamily: font.body, maxWidth: 480 }}>
          Deposits into Umbra are public. After that, a relayer submits your private payments, swaps and withdrawals, so they are not linked to your wallet.
        </small>
      </div>
      {!narrow && <div style={{ display: "grid", placeItems: "center" }}>
        <svg viewBox="0 0 320 320" width="300" height="300" fill="none" style={{ transform: `rotate(${Math.sin(frame / 60) * 3}deg)` }}>
          <defs>
            <linearGradient id="hl" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#e6f7ee" />
              <stop offset="1" stopColor="#8fd6b1" />
            </linearGradient>
            <mask id="hc"><rect width="320" height="320" fill="#fff" /><circle cx="196" cy="124" r="78" fill="#000" /></mask>
          </defs>
          <circle cx="160" cy="160" r="138" stroke="#d9f2e4" strokeOpacity=".16" strokeDasharray="2 9" />
          <circle cx="160" cy="160" r="112" stroke="#d9f2e4" strokeOpacity=".1" />
          <circle cx="160" cy="160" r="90" fill="url(#hl)" mask="url(#hc)" />
          <circle cx="160" cy="160" r="90" stroke="#d9f2e4" strokeOpacity=".3" strokeWidth="1.5" />
          <circle cx="226" cy="226" r="9" fill="#8fd6b1" />
        </svg>
      </div>}
    </div>
  );
};

export const Land: React.FC<{ orientation: Orientation }> = ({ orientation }) => {
  const frame = useCurrentFrame();
  // Pool activity grows as the scene plays (example: 12 → 48 private transactions). Level and
  // wording follow privacyLevel() / PrivatePoolMeter in the app: <20 Low, <100 Fair.
  const count = Math.round(Number(countUp(frame, 40, 200, 36, 0).replace(/,/g, ""))) + 12;
  const fair = count >= 20;
  return (
    <SceneLayout
      orientation={orientation}
      camera={[
        { at: 0, zoom: 1 },
        { at: 60, zoom: 1 },
        { at: 100, zoom: 1.32, focus: [0.36, 0.34] },
        { at: 175, zoom: 1.32, focus: [0.36, 0.34] },
        { at: 215, zoom: 1.5, focus: [0.5, 0.83] },
      ]}
      caption={
        <Caption
          number="01"
          label="Private payments on Portaldot"
          headline="Your money. Your privacy."
          support="The privacy meter shows the shared pool is already live and growing."
        />
      }
    >
      <BrowserFrame active="overview" account={null}>
        <Hero />
        <div style={{ marginTop: 20, padding: 20, border: `1px solid ${L.border}`, borderRadius: radius.lg, background: L.surface }}>
          <div style={{ color: L.muted, fontSize: 13, fontWeight: 600, marginBottom: 4, fontFamily: font.body }}>How private is the pool right now?</div>
          <PrivacyMeter
            level={fair ? 2 : 1}
            label={fair ? "Fair" : "Low"}
            title="Private pool activity"
            detail={`${count} private transactions so far. Your payment blends in with them.`}
          />
        </div>
      </BrowserFrame>
    </SceneLayout>
  );
};
