import React, { useRef } from "react";
import { interpolate, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs, useApp } from "../components/context";
import { Card, PrimaryButton, GhostButton, PrivacyNote, ToolbarLabel, PrivacyMeter } from "../components/ui";
import { light as L, font, shadow, brand } from "../theme";
import { appear, cursorAt, clickRipple, isPressing } from "../anim";
import { cueLocal } from "../timing.mjs";
import { ACCOUNT } from "./Account";
import { AccountCard, MSG, StatusSeq } from "./shared";

const PAY = cueLocal("requestPay"); // beat 13
const MSG_IN = 6;
const LINK = 58;
const OPEN = LINK + 8;
const BTN = 123;
const PAY_URL = "umbrav1.up.railway.app/?pay=Ak3x…9QfE"; // placeholder link payload
const fmt4 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const Request: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    height={{ landscape: 960, portrait: 1300 }}
    camera={[
      { at: 0, zoom: 1 },
      { at: 12, zoom: 1 },
      { at: 34, zoom: 1.55, focus: [0.5, 0.23] },
      { at: LINK + 4, zoom: 1.55, focus: [0.5, 0.23] },
      { at: OPEN + 24, zoom: 1.38, focus: [0.33, 0.4] },
      { at: BTN - 4, zoom: 1.42, focus: [0.33, 0.45] },
      { at: BTN + 26, zoom: 1.42, focus: [0.33, 0.72] },
      { at: PAY - 4, zoom: 1.42, focus: [0.33, 0.72] },
      { at: PAY + 16, zoom: 1.52, focus: [0.33, 0.42] },
      { at: PAY + 50, zoom: 1.52, focus: [0.33, 0.42] },
      { at: PAY + 80, zoom: 1.3, focus: [0.55, 0.38] }, // confirmation + new balance together
    ]}
    caption={<Caption number="06" label="Request" headline="Get paid with a link." support="Open a ?pay= link: who, how much, which asset, what for. Then pay privately." />}
  >
    <RequestBody />
  </SceneLayout>
);

// The friend's chat message carrying the request link (a messenger bubble, not Umbra UI).
const MessageBubble: React.FC<{ frame: number; linkRef: React.RefObject<HTMLSpanElement> }> = ({ frame, linkRef }) => {
  const { fps } = useVideoConfig();
  if (frame > OPEN + 8) return null;
  const s = spring({ frame: frame - MSG_IN, fps, config: { damping: 14, mass: 0.7 } });
  const o = appear(frame, MSG_IN, 6) * (1 - appear(frame, OPEN, 8));
  return (
    <div style={{ position: "absolute", top: 150, left: "50%", width: 520, marginLeft: -260, opacity: o, transform: `translateY(${interpolate(s, [0, 1], [-30, 0])}px) scale(${interpolate(s, [0, 1], [0.94, 1])})`, zIndex: 30 }}>
      <div style={{ padding: 18, borderRadius: 22, background: "#ffffff", boxShadow: shadow.lg, border: `1px solid ${L.border}`, display: "flex", gap: 14 }}>
        <span style={{ flex: "none", display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: "50%", background: brand.brand, color: "#fff", fontWeight: 700, fontSize: 18 }}>S</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <strong style={{ color: L.ink, fontSize: 16 }}>Sam</strong>
            <small style={{ color: L.muted }}>now</small>
          </div>
          <p style={{ margin: "4px 0 8px", color: L.ink2, fontSize: 15 }}>Concert tickets 🎟️ here's your share</p>
          <Anchor r={linkRef}>
            <span style={{ display: "inline-block", padding: "8px 12px", borderRadius: 12, background: L.accentSoft, color: L.accentInk, fontFamily: font.mono, fontSize: 13, textDecoration: "underline" }}>{PAY_URL}</span>
          </Anchor>
        </div>
      </div>
    </div>
  );
};

const RequestBody: React.FC = () => {
  const frame = useCurrentFrame();
  const portrait = useApp().orientation === "portrait";
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["link", "payPrivate"] as const);
  const pts = useAnchors(box, refs);

  const opened = frame >= OPEN;
  const paid = frame >= PAY;
  const tpot = fmt4(interpolate(frame, [PAY, PAY + 30], [37.4375, 34.925], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  const pos = cursorAt(frame, portrait ? [620, 1150] : [980, 820], [
    { start: MSG_IN + 14, end: LINK - 2, to: "link" },
    { start: OPEN + 16, end: BTN - 2, to: "payPrivate" },
  ], pts);

  return (
    <AppBox ref={box}>
      <BrowserFrame active={opened ? "pay" : "wallet"} account={ACCOUNT} url={opened ? PAY_URL : undefined}>
        {!opened ? (
          <>
            <PageHeading title="Wallet" description="Your balances, ways to get paid, and the people you pay." />
            <Grid><AccountCard frame={frame} tpot="37.4375" pusd="0.0000" /></Grid>
          </>
        ) : (
          <div style={{ opacity: appear(frame, OPEN, 8) }}>
            <PageHeading title="Pay a request" description="Someone sent you a payment request." />
            <Grid>
              <Card>
                <ToolbarLabel>Payment request</ToolbarLabel>
                <h2 style={{ margin: "8px 0 6px", font: `800 44px/1.05 ${font.display}`, letterSpacing: "-0.04em", color: L.ink }}>
                  2.5 <small style={{ color: L.muted, fontSize: 18, fontWeight: 600 }}>tPOT</small>
                </h2>
                <p style={{ margin: "0 0 4px", color: L.ink, fontSize: 15 }}><strong>Sam</strong> is asking you to pay for <em>Concert tickets</em>.</p>
                {!paid && (
                  <>
                    <ToolbarLabel style={{ marginTop: 16, marginBottom: 8 }}>Pay privately</ToolbarLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      <Anchor r={refs.payPrivate}>
                        <PrimaryButton pressed={isPressing(frame, BTN)}>{frame >= BTN ? "Working…" : "From my private balance (37.4375 tPOT)"}</PrimaryButton>
                      </Anchor>
                      <GhostButton>From my wallet</GhostButton>
                    </div>
                    <PrivacyNote>From your private balance, nobody can see who paid whom or how much. No wallet connection needed.</PrivacyNote>
                    <PrivacyNote style={{ marginTop: 0 }}>Umbra's relayer submits this transaction, so your wallet does not sign it. Withdrawal addresses and amounts remain public, and timing can still link activity. Fee: 0.0125 tPOT, taken from your private balance.</PrivacyNote>
                    <PrivacyMeter level={2} label="Fair" title="Private pool activity" detail="50 private transactions so far. Your payment blends in with them." style={{ margin: "0 0 4px" }} />
                  </>
                )}
                <StatusSeq
                  frame={frame}
                  steps={[
                    { at: BTN + 4, kind: "info", text: MSG.proof, shimmer: true },
                    { at: BTN + 56, kind: "info", text: MSG.submitting },
                    { at: PAY, kind: "ok", text: <>Paid privately · relayed in block <span style={{ fontFamily: font.mono }}>0x9b2d…41ce</span>. Their app will match this payment automatically.</> },
                  ]}
                />
                {paid && <div style={{ marginTop: 12, color: L.accent, fontWeight: 600, fontSize: 13, opacity: appear(frame, PAY + 10, 8) }}>Back to Umbra →</div>}
              </Card>
              <AccountCard frame={frame} tpot={tpot} pusd="0.0000" popAt={paid ? PAY : undefined} highlight="tpot" />
            </Grid>
          </div>
        )}
      </BrowserFrame>
      <MessageBubble frame={frame} linkRef={refs.link} />
      {frame < BTN + 14 && (
        <Cursor x={pos[0]} y={pos[1]} clicking={isPressing(frame, LINK) || isPressing(frame, BTN)} ripple={Math.max(clickRipple(frame, LINK), clickRipple(frame, BTN))} />
      )}
    </AppBox>
  );
};

