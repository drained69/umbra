import React, { useRef } from "react";
import { useCurrentFrame } from "remotion";
import { BrowserFrame } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs } from "../components/context";
import { light as L, font, brand, heroGradient, radius, shadow } from "../theme";
import { appear, cursorAt, clickRipple, isPressing } from "../anim";
import { cueLocal } from "../timing.mjs";

const CLICK = cueLocal("connectClick"); // beat 3
const PICK = cueLocal("connectPick"); // beat 10

const MiniHero: React.FC = () => (
  <div style={{ padding: "44px 44px", borderRadius: radius.xl, background: heroGradient, color: "#eaf6ef" }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid rgba(217,242,228,0.25)", borderRadius: 999, color: "#cdebdc", fontSize: 13, fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: brand.mint }} />
      Private payments on Portaldot · Testnet
    </span>
    <h1 style={{ margin: "16px 0 12px", color: "#fff", fontFamily: font.display, fontSize: 48, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.035em" }}>
      Your money.<br /><em style={{ fontStyle: "normal", color: brand.mint }}>Your privacy.</em>
    </h1>
    <p style={{ margin: 0, maxWidth: 470, color: "#c7e3d4", fontSize: 16, lineHeight: 1.5 }}>Pay, request, split bills and swap on Portaldot, publicly or privately. You choose what is shared, and you see it before anything is sent.</p>
  </div>
);

// The real "Connect your wallet" prompt (App.tsx connectPrompt).
const ConnectPrompt: React.FC = () => (
  <div style={{ maxWidth: 560, margin: "22px auto 0", padding: "40px 28px", border: `1px solid ${L.border}`, borderRadius: radius.xl, background: L.surface, textAlign: "center", boxShadow: shadow.md }}>
    <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 22, fontWeight: 700, color: L.ink }}>Connect your wallet</h2>
    <p style={{ margin: "8px auto 20px", maxWidth: 380, color: L.muted, fontSize: 15 }}>Connect to see your balances, pay friends and swap. Umbra never holds your keys or your funds.</p>
    <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ padding: "11px 18px", borderRadius: radius.sm, background: L.accent, color: "#fff", fontWeight: 600, fontSize: 14 }}>Connect Portaldot wallet</div>
      <div style={{ padding: "10px 14px", borderRadius: radius.sm, border: `1px solid ${L.borderStrong}`, color: L.ink, fontWeight: 600, fontSize: 13.5 }}>Use an EVM wallet</div>
    </div>
  </div>
);

export const Connect: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    pushIn={{ start: PICK + 4, end: PICK + 40, to: 1.25, focus: [0.86, 0.1], release: PICK + 110 }}
    caption={<Caption number="02" label="Connect" headline="Self-custody, always." support="Portaldot Extension or MetaMask. Umbra never holds your keys." />}
  >
    <ConnectBody />
  </SceneLayout>
);

const ConnectBody: React.FC = () => {
  const frame = useCurrentFrame();
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["connect", "alice"] as const);
  const pts = useAnchors(box, refs);

  const connected = frame >= PICK + 4;
  const connecting = frame >= CLICK && !connected;
  const pickerOpen = frame >= CLICK + 4 && frame < PICK + 4;

  const pos = cursorAt(frame, [560, 640], [
    { start: 4, end: CLICK - 2, to: "connect" },
    { start: CLICK + 14, end: PICK - 2, to: "alice" },
  ], pts);

  return (
    <AppBox ref={box}>
      <BrowserFrame active="overview" connecting={connecting} connectRef={refs.connect} account={connected ? { initial: "A", label: "Alice", balance: "1,240.00 tPOT" } : null}>
        <MiniHero />
        <ConnectPrompt />
      </BrowserFrame>

      {pickerOpen && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(8,14,11,0.55)", display: "grid", placeItems: "center", opacity: appear(frame, CLICK + 4, 8), borderRadius: radius.lg + 4 }}>
          <div style={{ width: 460, padding: 24, borderRadius: radius.lg, background: L.surface, boxShadow: shadow.lg, border: `1px solid ${L.border}`, transform: `translateY(${(1 - appear(frame, CLICK + 4, 10)) * 16}px)` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: font.display, fontSize: 20, fontWeight: 700, color: L.ink }}>Choose an account</h2>
                <p style={{ margin: "4px 0 0", color: L.muted, fontSize: 13 }}>Umbra will ask this wallet to sign each transaction.</p>
              </div>
              <span style={{ color: L.muted, fontSize: 22, lineHeight: 1 }}>×</span>
            </div>
            {[
              { name: "Alice", addr: "5Dw9…K2mf", src: "polkadot-js" },
              { name: "Savings", addr: "5Fh2…9Qtp", src: "polkadot-js" },
            ].map((a, i) => {
              const row = (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 8,
                    padding: 12,
                    border: `1px solid ${i === 0 && frame >= PICK - 14 ? L.accent : L.border}`,
                    borderRadius: radius.r,
                    background: i === 0 && frame >= PICK - 14 ? L.accentSoft : L.surface,
                  }}
                >
                  <span style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10, background: L.accentSoft, color: L.accentInk, fontWeight: 700 }}>{a.name[0]}</span>
                  <span style={{ flex: 1 }}>
                    <strong style={{ display: "block", color: L.ink }}>{a.name}</strong>
                    <small style={{ display: "block", marginTop: 3, color: L.muted, fontFamily: font.mono, fontSize: 12.5 }}>{a.addr} · {a.src}</small>
                  </span>
                  <span style={{ color: L.muted }}>→</span>
                </div>
              );
              return i === 0 ? <Anchor key={a.name} r={refs.alice} block>{row}</Anchor> : <div key={a.name}>{row}</div>;
            })}
          </div>
        </div>
      )}

      <Cursor x={pos[0]} y={pos[1]} clicking={isPressing(frame, CLICK) || isPressing(frame, PICK)} ripple={Math.max(clickRipple(frame, CLICK), clickRipple(frame, PICK))} />
    </AppBox>
  );
};
