import React from "react";
import { interpolate, spring, useVideoConfig } from "remotion";
import { Card, CardTitle, BalanceTile, StatusLine, Chip } from "../components/ui";
import { light as L, font, radius, shadow, brand } from "../theme";
import { appear } from "../anim";

// Real progress strings from frontend/src/lib/{multi,shielded,pay}.ts and the panels.
export const MSG = {
  proof: "Generating a zero-knowledge proof in your browser…",
  contacting: "Contacting the relayer…",
  submitting: "The relayer is submitting it. Nothing for your wallet to sign…",
  confirmWallet: "Confirm the transaction in your wallet…",
  swapRelay: "The relayer is trading and settling it. Nothing for your wallet to sign…",
};

export type Step = { at: number; kind: "info" | "ok"; text: React.ReactNode; shimmer?: boolean };

// Shows the latest status step; info steps with `shimmer` get the proof-generation sweep.
export const StatusSeq: React.FC<{ frame: number; steps: Step[] }> = ({ frame, steps }) => {
  const live = [...steps].reverse().find((s) => frame >= s.at);
  if (!live) return null;
  const local = frame - live.at;
  return (
    <div style={{ position: "relative", opacity: appear(frame, live.at, 6) }}>
      <StatusLine kind={live.kind} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", overflow: "hidden" }}>
        {live.kind === "info" ? (
          <span style={{ flex: "none", width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(47,95,138,0.25)", borderTopColor: "#2f5f8a", transform: `rotate(${local * 14}deg)` }} />
        ) : (
          <span style={{ flex: "none", display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: "50%", background: L.accent, color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>
        )}
        <span style={{ position: "relative" }}>{live.text}</span>
        {live.shimmer && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.65) 45%, transparent 60%)",
              transform: `translateX(${((local * 3.2) % 160) - 60}%)`,
            }}
          />
        )}
      </StatusLine>
      {live.shimmer && (
        <div style={{ height: 3, marginTop: 6, borderRadius: 3, background: L.surface3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, local * 1.1)}%`, background: L.accent, borderRadius: 3 }} />
        </div>
      )}
    </div>
  );
};

// The compact private-account card (PrivateAccountCard compact), with a pop when balances change.
export const AccountCard: React.FC<{ tpot: string; pusd: string; popAt?: number; frame: number; highlight?: "tpot" | "pusd" | "both" }> = ({ tpot, pusd, popAt, frame, highlight }) => {
  const { fps } = useVideoConfig();
  const pop = popAt !== undefined && frame >= popAt ? spring({ frame: frame - popAt, fps, config: { damping: 12, mass: 0.6 } }) : 1;
  const ring = popAt !== undefined && frame >= popAt ? interpolate(pop, [0, 1], [10, 0]) : 0;
  const hl = (k: "tpot" | "pusd") => popAt !== undefined && frame >= popAt && frame < popAt + 70 && (highlight === k || highlight === "both");
  return (
    <Card style={{ boxShadow: `0 0 0 ${ring}px rgba(29,127,87,0.22), ${shadow.sm}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <CardTitle>Private account</CardTitle>
        <span style={{ color: L.accent, fontWeight: 600, fontSize: 13 }}>Refresh</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <BalanceTile label="tPOT balance" amount={tpot} unit="tPOT" highlight={hl("tpot")} style={{ transform: `scale(${hl("tpot") ? interpolate(pop, [0, 1], [1.08, 1]) : 1})` }} />
        <BalanceTile label="pUSD balance" amount={pusd} unit="pUSD" highlight={hl("pusd")} style={{ transform: `scale(${hl("pusd") ? interpolate(pop, [0, 1], [1.08, 1]) : 1})` }} />
      </div>
    </Card>
  );
};

// Generic wallet signature sheet (the Portaldot Extension asks to sign the deposit).
export const WalletSheet: React.FC<{ frame: number; at: number; until: number; signRef?: React.RefObject<HTMLSpanElement>; pressed?: boolean; amount: string }> = ({ frame, at, until, signRef, pressed, amount }) => {
  if (frame < at || frame > until) return null;
  const o = appear(frame, at, 8) * (1 - appear(frame, until - 6, 6));
  return (
    <div style={{ position: "absolute", top: 120, right: 24, width: 340, opacity: o, transform: `translateY(${(1 - appear(frame, at, 10)) * -14}px)`, borderRadius: radius.lg, background: L.surface, border: `1px solid ${L.border}`, boxShadow: shadow.lg, overflow: "hidden", zIndex: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: brand.brandDeep, color: "#eaf6ef", fontSize: 13, fontWeight: 600 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: brand.mint }} />
        Portaldot Extension
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ color: L.muted, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Sign transaction</div>
        <div style={{ margin: "6px 0 2px", font: `800 26px/1.2 ${font.display}`, color: L.ink }}>{amount}</div>
        <div style={{ color: L.muted, fontSize: 13, fontFamily: font.mono }}>from Alice · 5Dw9…K2mf</div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "10px 0", borderRadius: radius.sm, border: `1px solid ${L.borderStrong}`, fontSize: 13.5, fontWeight: 600 }}>Cancel</div>
          <span ref={signRef} style={{ flex: 1, display: "block" }}>
            <div style={{ textAlign: "center", padding: "10px 0", borderRadius: radius.sm, background: pressed ? L.accentHover : L.accent, color: "#fff", fontSize: 13.5, fontWeight: 600 }}>Sign</div>
          </span>
        </div>
      </div>
    </div>
  );
};

export const SubTabs: React.FC<{ items: string[]; active: number }> = ({ items, active }) => (
  <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, marginBottom: 20, padding: 4, borderRadius: radius.r, background: L.surface3 }}>
    {items.map((t, i) => (
      <div key={t} style={{ padding: "8px 14px", borderRadius: radius.sm, background: i === active ? L.surface : "transparent", color: i === active ? L.ink : L.muted, font: `600 13.5px/1.1 ${font.body}`, boxShadow: i === active ? "0 1px 2px rgba(15,26,20,0.05)" : "none", whiteSpace: "nowrap" }}>{t}</div>
    ))}
  </div>
);

export const ChipRow: React.FC<{ items: string[]; active: number; style?: React.CSSProperties }> = ({ items, active, style }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, ...style }}>
    {items.map((t, i) => <Chip key={t} active={i === active}>{t}</Chip>)}
  </div>
);
