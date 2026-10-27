import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Card, CardTitle, Hint, ToolbarLabel, PrimaryButton, GhostButton } from "../components/ui";
import { light as L, font, radius, brand } from "../theme";
import { appear, countUp } from "../anim";
import { cueLocal } from "../timing.mjs";

const PING = cueLocal("resultPing"); // beat 6
const BOB = { initial: "B", label: "Bob", balance: "312.40 tPOT" }; // example recipient account

export const Result: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    height={{ landscape: 860, portrait: 1180 }}
    camera={[
      { at: 0, zoom: 1 },
      { at: 22, zoom: 1 },
      { at: PING - 8, zoom: 1.55, focus: [0.8, 0.31] },
      { at: PING + 4, zoom: 1.55, focus: [0.8, 0.31] },
      { at: PING + 28, zoom: 1.62, focus: [0.33, 0.56] },
      { at: CHAIN_IN - 6, zoom: 1.62, focus: [0.33, 0.56] },
      { at: CHAIN_IN + 22, zoom: 1.62, focus: [0.78, 0.62] },
    ]}
    caption={<Caption number="08" label="Received" headline="No trace back to the sender." support="Bob sees 12.5 tPOT and the memo. The chain sees only a verified proof." />}
  >
    <ResultBody />
  </SceneLayout>
);

const Tile: React.FC<{ label: string; children: React.ReactNode; highlight?: boolean; glow?: number }> = ({ label, children, highlight, glow = 0 }) => (
  <div
    style={{
      padding: "18px 20px",
      border: `1px solid ${highlight ? "rgba(29,127,87,0.35)" : L.border}`,
      borderRadius: radius.lg,
      background: highlight ? `linear-gradient(160deg, ${L.accentSoft}, ${L.surface} 70%)` : L.surface,
      boxShadow: `0 0 0 ${glow}px rgba(29,127,87,0.22)`,
    }}
  >
    <span style={{ display: "block", color: L.muted, fontSize: 13, fontWeight: 600 }}>{label}</span>
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "baseline" }}>{children}</div>
  </div>
);

const Amount: React.FC<{ v: string; unit: string }> = ({ v, unit }) => (
  <strong style={{ font: `800 26px/1.15 ${font.display}`, letterSpacing: "-0.03em", color: L.ink, whiteSpace: "nowrap" }}>
    {v} <small style={{ color: L.muted, font: `600 14px ${font.body}` }}>{unit}</small>
  </strong>
);

// Explanatory overlay (a video graphic, styled apart from the app UI). Rows land on the
// narration: "The chain sees only a verified proof. No sender. No amount. No trace."
const CHAIN_IN = 140; // local frame; "The chain sees…" starts at 105.2 s
const CHAIN_ROWS: [string, string, number][] = [
  ["Zero-knowledge proof", "verified ✔", 172],
  ["Submitted by", "Umbra relayer", 188],
  ["Sender", "hidden", 226],
  ["Recipient", "hidden", 236],
  ["Amount", "hidden", 259],
  ["Memo", "encrypted", 272],
];
const ChainView: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ opacity: appear(frame, CHAIN_IN, 10), transform: `translateY(${(1 - appear(frame, CHAIN_IN, 12)) * 16}px)`, padding: 22, borderRadius: radius.lg, background: brand.brandDeep, color: "#eaf6ef", border: "1px solid rgba(143,214,177,0.25)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: brand.mint, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: brand.mint }} /> What the chain sees
    </div>
    <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
      {CHAIN_ROWS.map(([k, v, at], i) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 15, opacity: 0.25 + 0.75 * appear(frame, at, 8) }}>
          <span style={{ color: "#9fc6b2" }}>{k}</span>
          <strong style={{ color: i === 0 ? brand.mint : "#fff", fontWeight: 700, opacity: appear(frame, at, 8) }}>{v}</strong>
        </div>
      ))}
    </div>
  </div>
);

const ResultBody: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const arrived = frame >= PING;
  const pop = arrived ? spring({ frame: frame - PING, fps, config: { damping: 12, mass: 0.6 } }) : 0;
  const priv = arrived ? countUp(frame, PING, PING + 24, 12.5, 4) : null;

  return (
    <BrowserFrame active="wallet" account={BOB}>
      <PageHeading title="Wallet" description="Your balances, ways to get paid, and the people you pay." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, marginBottom: 16 }}>
        <Tile label="tPOT balance"><Amount v="312.4000" unit="tPOT" /></Tile>
        <Tile label="pUSD balance"><Amount v="0.0000" unit="pUSD" /></Tile>
        <Tile label="Private balances" highlight glow={arrived ? interpolate(pop, [0, 1], [10, 0]) : 0}>
          {priv === null ? <Amount v="Scanning…" unit="" /> : <><Amount v={priv} unit="tPOT" /><Amount v="0.0000" unit="pUSD" /></>}
        </Tile>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <PrimaryButton>Send</PrimaryButton>
        <GhostButton>Request</GhostButton>
        <GhostButton>Split a bill</GhostButton>
        <GhostButton>Swap</GhostButton>
      </div>
      <Grid>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <CardTitle>Activity</CardTitle>
            <span style={{ color: L.accent, fontWeight: 600, fontSize: 13 }}>My requests →</span>
          </div>
          {arrived && (
            <>
              <ToolbarLabel style={{ marginTop: 6 }}>Received privately</ToolbarLabel>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 8,
                  padding: "12px 10px",
                  borderRadius: radius.sm,
                  background: frame < PING + 60 ? `rgba(230,243,236,${1 - appear(frame, PING + 30, 30)})` : "transparent",
                  transform: `translateY(${interpolate(pop, [0, 1], [-14, 0])}px)`,
                  opacity: appear(frame, PING, 6),
                  fontSize: 14,
                }}
              >
                <span style={{ padding: "3px 8px", borderRadius: 999, background: L.accentSoft, color: L.accentInk, fontSize: 11.5, fontWeight: 700 }}>private</span>
                <span style={{ flex: 1, color: L.ink }}>Rent for May</span>
                <strong style={{ color: L.ink }}>+12.5000 tPOT</strong>
              </div>
            </>
          )}
          <ToolbarLabel style={{ marginTop: 12 }}>Recent</ToolbarLabel>
          <Hint style={{ margin: "6px 0 0" }}>Payments, requests and swaps you make here will appear in this list.</Hint>
        </Card>
        <ChainView frame={frame} />
      </Grid>
    </BrowserFrame>
  );
};
