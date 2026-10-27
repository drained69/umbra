import React, { useRef } from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs, useApp } from "../components/context";
import { Card, CardTitle, Hint, Label, Field, PrimaryButton, GhostButton, BalanceTile, PrivacyNote } from "../components/ui";
import { light as L, font, radius } from "../theme";
import { appear, typed, cursorAt, clickRipple, isPressing } from "../anim";
import { cueLocal } from "../timing.mjs";

const CREATE = cueLocal("accountCreate"); // beat 6
const BAL = cueLocal("accountBalance"); // beat 15
const SAVED = BAL - 16;

export const ACCOUNT = { initial: "A", label: "Alice", balance: "1,240.00 tPOT" }; // example account
export const PRIVATE_ADDR = "umbra-addr-7h3q…x9f2"; // placeholder, not a real address

export const PrivacyNav: React.FC<{ active?: number }> = ({ active = 0 }) => (
  <div style={{ display: "inline-flex", gap: 4, marginBottom: 20, padding: 4, borderRadius: radius.r, background: L.surface3 }}>
    {["Private balance", "Shield", "Withdraw", "Viewing keys"].map((t, i) => (
      <div key={t} style={{ padding: "8px 14px", borderRadius: radius.sm, background: i === active ? L.surface : "transparent", color: i === active ? L.ink : L.muted, font: `600 13.5px/1.1 ${font.body}`, boxShadow: i === active ? "0 1px 2px rgba(15,26,20,0.05)" : "none", whiteSpace: "nowrap" }}>{t}</div>
    ))}
  </div>
);

export const Account: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    pushIn={{ start: BAL, end: BAL + 50, to: 1.3, focus: orientation === "portrait" ? [0.5, 0.4] : [0.3, 0.52] }}
    caption={<Caption number="03" label="Private account" headline="One spend key is all it takes." support="A private address and a private balance in tPOT and pUSD." />}
  >
    <AccountBody />
  </SceneLayout>
);

const AccountBody: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const portrait = useApp().orientation === "portrait";
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["create", "saved"] as const);
  const pts = useAnchors(box, refs);

  const stage = frame < CREATE + 8 ? "create" : frame < BAL ? "backup" : "ready";
  const pass = "•".repeat(typed("xxxxxxxxxxxx", frame, 8, 34).length);
  const pass2 = "•".repeat(typed("xxxxxxxxxxxx", frame, 38, 64).length);
  const pop = spring({ frame: frame - BAL, fps, config: { damping: 12, mass: 0.6 } });
  const tileScale = frame >= BAL ? interpolate(pop, [0, 1], [0.92, 1]) : 1;

  const pos = cursorAt(frame, portrait ? [600, 1100] : [900, 760], [
    { start: 40, end: CREATE - 2, to: "create" },
    { start: CREATE + 60, end: SAVED - 2, to: "saved" },
  ], pts);

  return (
    <AppBox ref={box}>
      <BrowserFrame active="transfer" account={ACCOUNT}>
        <PrivacyNav />
        <PageHeading title="Private balance" description="Add funds, pay other private addresses and withdraw, without exposing your wallet." />
        <Grid>
          {stage === "create" && (
            <Card>
              <CardTitle>Private account</CardTitle>
              <Hint>Get a private address for receiving encrypted payments. Its spend key is the only way to move the balance, so you'll be asked to save it.</Hint>
              <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0 4px", color: L.ink2, fontSize: 14 }}>
                <span style={{ flex: "none", width: 18, height: 18, borderRadius: 4, background: L.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 12 }}>✓</span>
                Remember it in this browser, protected by a passcode
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><Label>Passcode</Label><Field value={pass} placeholder="At least 8 characters" focused={frame >= 8 && frame < 36} /></div>
                <div><Label>Repeat passcode</Label><Field value={pass2} focused={frame >= 38 && frame < 70} /></div>
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 16 }}>
                <Anchor r={refs.create}><PrimaryButton pressed={isPressing(frame, CREATE)}>{frame >= CREATE ? "Securing…" : "Create private account"}</PrimaryButton></Anchor>
                <span style={{ color: L.accent, fontWeight: 600, fontSize: 13 }}>I already have a spend key</span>
              </div>
            </Card>
          )}
          {stage === "backup" && (
            <Card style={{ opacity: appear(frame, CREATE + 8, 10) }}>
              <CardTitle>Private account</CardTitle>
              <div style={{ marginTop: 12, padding: 16, border: "1px solid rgba(138,93,14,0.35)", borderRadius: radius.r, background: L.warnSoft }}>
                <strong style={{ display: "block", color: L.warn, marginBottom: 4 }}>Save your spend key</strong>
                <Hint style={{ margin: "0 0 10px" }}>Without it this balance cannot be recovered in another browser.</Hint>
                <div style={{ padding: "12px", minHeight: 70, border: `1px solid ${L.borderStrong}`, borderRadius: radius.sm, background: L.surface, fontFamily: font.mono, fontSize: 13, color: L.muted, letterSpacing: "0.06em", lineHeight: 1.6 }}>
                  umbra-sk-•••• •••• •••• •••• •••• •••• •••• •••• •••• ••••
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <GhostButton>Copy spend key</GhostButton>
                  <Anchor r={refs.saved}><PrimaryButton pressed={isPressing(frame, SAVED)}>I saved it</PrimaryButton></Anchor>
                </div>
              </div>
            </Card>
          )}
          {stage === "ready" && (
            <Card style={{ transform: `scale(${tileScale})`, transformOrigin: "50% 30%", boxShadow: `0 0 0 ${interpolate(pop, [0, 1], [10, 0])}px rgba(29,127,87,0.2)` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <CardTitle>Private account</CardTitle>
                <span style={{ color: L.accent, fontWeight: 600, fontSize: 13 }}>Refresh</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "12px 0 16px" }}>
                <BalanceTile label="tPOT balance" amount="0.0000" unit="tPOT" />
                <BalanceTile label="pUSD balance" amount="0.0000" unit="pUSD" />
              </div>
              <div style={{ paddingTop: 14, borderTop: `1px solid ${L.border}`, color: L.muted, fontSize: 14 }}>Saved in this browser, encrypted with your passcode.</div>
            </Card>
          )}
          {stage === "ready" ? (
            <Card style={{ opacity: appear(frame, BAL + 10, 12) }}>
              <Label style={{ marginTop: 0 }}>Shareable private address</Label>
              <Field value={PRIVATE_ADDR} mono />
              <GhostButton style={{ marginTop: 10 }}>Copy address</GhostButton>
              <PrivacyNote>Payments to this address are encrypted. The chain shows neither you as the recipient nor the amount.</PrivacyNote>
            </Card>
          ) : (
            <Card>
              <CardTitle>Move private funds</CardTitle>
              <Hint>Deposit any amount, send to another private address, or withdraw to any wallet.</Hint>
              <Hint style={{ margin: 0 }}>Confirm you saved the spend key before moving funds.</Hint>
            </Card>
          )}
        </Grid>
      </BrowserFrame>
      {frame < BAL + 6 && (
        <Cursor x={pos[0]} y={pos[1]} clicking={isPressing(frame, CREATE) || isPressing(frame, SAVED)} ripple={Math.max(clickRipple(frame, CREATE), clickRipple(frame, SAVED))} />
      )}
    </AppBox>
  );
};
