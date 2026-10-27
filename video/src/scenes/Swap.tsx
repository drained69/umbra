import React, { useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs, useApp } from "../components/context";
import { Card, CardTitle, Hint, PrimaryButton, PrivacyNote, ToolbarLabel } from "../components/ui";
import { light as L, font, radius } from "../theme";
import { appear, typed, cursorAt, clickRipple, isPressing, caretOn, fmtAmount } from "../anim";
import { cueLocal } from "../timing.mjs";
import { ACCOUNT } from "./Account";
import { AccountCard, MSG, StatusSeq, SubTabs } from "./shared";

const PROOF = cueLocal("swapProof"); // beat 8
const DONE = cueLocal("swapDone"); // beat 20
const INPUT = 28;
const QUOTE = 62;
const BTN = PROOF - 6;

// A real quote from the live relayer (/ma/quote, 2026-10-27): 4 tPOT → 3.215426 pUSD, fee 9 tPOT,
// price impact 2.66%. Live prices move; this is a snapshot.
const OUT = "3.215426";

export const Swap: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    height={{ landscape: 960, portrait: 1300 }}
    camera={[
      { at: 0, zoom: 1 },
      { at: 18, zoom: 1 },
      { at: INPUT + 10, zoom: 1.45, focus: [0.33, 0.5] },
      { at: QUOTE + 4, zoom: 1.45, focus: [0.33, 0.52] },
      { at: QUOTE + 34, zoom: 1.42, focus: [0.33, 0.68] },
      { at: BTN - 4, zoom: 1.42, focus: [0.33, 0.8] },
      { at: PROOF + 14, zoom: 1.48, focus: [0.33, 0.88] },
      { at: DONE + 2, zoom: 1.48, focus: [0.33, 0.88] },
      { at: DONE + 30, zoom: 1.75, focus: [0.78, 0.33] },
    ]}
    caption={<Caption number="07" label="Private swap" headline="Trade without leaving privacy." support="4 tPOT to pUSD at live exchange prices, inside your private balance." />}
  >
    <SwapBody />
  </SceneLayout>
);

const Leg: React.FC<{ label: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ label, right, children }) => (
  <div style={{ marginTop: 12, padding: "14px 16px", border: `1px solid ${L.border}`, borderRadius: radius.r, background: L.surface2 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <ToolbarLabel>{label}</ToolbarLabel>
      {right && <span style={{ color: L.muted, fontSize: 14 }}>{right}</span>}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>{children}</div>
  </div>
);

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ flex: "none", padding: "7px 12px", border: `1px solid ${L.border}`, borderRadius: 999, background: L.surface, fontWeight: 700, fontSize: 14 }}>{children}</span>
);

const SwapBody: React.FC = () => {
  const frame = useCurrentFrame();
  const portrait = useApp().orientation === "portrait";
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["input", "swap"] as const);
  const pts = useAnchors(box, refs);

  const amount = typed("4", frame, INPUT + 4, INPUT + 10);
  const quoted = frame >= QUOTE;
  const done = frame >= DONE;
  const k = interpolate(frame, [DONE, DONE + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tpot = fmtAmount(17 - 13 * k); // 4 sold + 9 relayer fee
  const pusd = fmtAmount(3.215426 * k);
  const avail = done ? "4" : "17";

  const pos = cursorAt(frame, portrait ? [620, 1150] : [980, 820], [
    { start: 4, end: INPUT - 2, to: "input" },
    { start: QUOTE + 10, end: BTN - 2, to: "swap" },
  ], pts);

  const rows: [string, string, boolean?][] = [
    ["Rate", "1 tPOT ≈ 0.80386 pUSD"],
    ["Relayer fee", "9 tPOT"],
    ["Total from your private balance", "13 tPOT"],
    ["Price impact", "2.66%"],
  ];

  return (
    <AppBox ref={box}>
      <BrowserFrame active="swap" account={ACCOUNT}>
        <PageHeading title="Swap" description="Trade tPOT and pUSD on Portaldot's built-in exchange." />
        <SubTabs items={["Private swap", "From my wallet"]} active={0} />
        <Grid>
          <Card>
            <CardTitle>Private swap</CardTitle>
            <Hint>Trade inside your private balance. The relayer buys on Portaldot's exchange and your new pUSD arrives as a private note, in one transaction it submits for you.</Hint>
            <Leg label="You sell" right={`Private: ${avail} tPOT`}>
              <Anchor r={refs.input}>
                <span style={{ display: "inline-flex", alignItems: "center", minWidth: 220, font: `700 26px/1.2 ${font.display}`, color: amount ? L.ink : L.muted }}>
                  {amount || "0.0"}
                  {frame >= INPUT && frame < BTN && caretOn(frame) && <span style={{ width: 2, height: 28, marginLeft: 2, background: L.accent }} />}
                </span>
              </Anchor>
              <span style={{ flex: 1 }} />
              <Badge>tPOT</Badge>
            </Leg>
            <div style={{ display: "grid", placeItems: "center", width: 38, height: 38, margin: "-10px auto", position: "relative", zIndex: 1, border: `4px solid ${L.surface}`, borderRadius: 12, background: L.surface3, fontSize: 16 }}>⇅</div>
            <Leg label="You receive (exactly)">
              <strong style={{ flex: 1, font: `700 26px/1.2 ${font.display}`, color: L.ink, opacity: quoted ? appear(frame, QUOTE, 8) : 1 }}>{quoted ? OUT : "—"}</strong>
              <Badge>pUSD</Badge>
            </Leg>
            {quoted && (
              <div style={{ display: "grid", gap: 8, marginTop: 16, padding: "14px 16px", border: `1px solid ${L.border}`, borderRadius: radius.r, fontSize: 14 }}>
                {rows.map(([dt, dd], i) => (
                  <div key={dt} style={{ display: "flex", justifyContent: "space-between", gap: 12, opacity: appear(frame, QUOTE + 2 + i * 4, 8) }}>
                    <span style={{ color: L.muted }}>{dt}</span>
                    <span style={{ fontWeight: 600, color: L.ink }}>{dd}</span>
                  </div>
                ))}
              </div>
            )}
            <PrivacyNote>Hidden: who traded. Your wallet never signs, and the chain shows the relayer trading on the exchange. The traded amounts are visible there, but not linked to you.</PrivacyNote>
            <Anchor r={refs.swap}>
              <PrimaryButton pressed={isPressing(frame, BTN)} disabled={!quoted}>{frame >= BTN && !done ? "Working…" : "Swap tPOT for pUSD privately"}</PrimaryButton>
            </Anchor>
            <StatusSeq
              frame={frame}
              steps={[
                { at: PROOF, kind: "info", text: MSG.proof, shimmer: true },
                { at: PROOF + 100, kind: "info", text: MSG.swapRelay },
                { at: DONE, kind: "ok", text: <>Swapped privately · relayed in block <span style={{ fontFamily: font.mono }}>0x2e7f…b803</span> <span style={{ fontWeight: 600, textDecoration: "underline" }}>view ↗</span></> },
              ]}
            />
          </Card>
          <AccountCard frame={frame} tpot={tpot} pusd={pusd} popAt={done ? DONE : undefined} highlight="both" />
        </Grid>
      </BrowserFrame>
      {frame < BTN + 14 && (
        <Cursor x={pos[0]} y={pos[1]} clicking={isPressing(frame, INPUT) || isPressing(frame, BTN)} ripple={Math.max(clickRipple(frame, INPUT), clickRipple(frame, BTN))} />
      )}
    </AppBox>
  );
};
