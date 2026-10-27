import React, { useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs, useApp } from "../components/context";
import { Card, CardTitle, Hint, Label, Field, PrimaryButton, PrivacyNote, ToolbarLabel } from "../components/ui";
import { light as L, font } from "../theme";
import { typed, cursorAt, clickRipple, isPressing, caretOn } from "../anim";
import { cueLocal } from "../timing.mjs";
import { ACCOUNT } from "./Account";
import { AccountCard, ChipRow, MSG, StatusSeq, SubTabs } from "./shared";

const PROOF = cueLocal("sendProof"); // beat 8
const SUBMIT = cueLocal("sendSubmit"); // beat 20
const TO = 18;
const AMT = 62;
const MEMO = 84;
const BTN = PROOF - 6;

export const RECIPIENT = "umbra-addr-k2m8…r4vd"; // placeholder recipient (Bob), not a real address
const fmt4 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export const Send: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    height={{ landscape: 1080, portrait: 1300 }}
    pushIn={{ start: SUBMIT, end: SUBMIT + 46, to: 1.28, focus: orientation === "portrait" ? [0.5, 0.86] : [0.76, 0.3] }}
    caption={<Caption number="05" label="Pay privately" headline="Your wallet never signs." support="12.5 tPOT to an umbra-addr. A relayer submits it, so nothing links back to you." />}
  >
    <SendBody />
  </SceneLayout>
);

const SendBody: React.FC = () => {
  const frame = useCurrentFrame();
  const portrait = useApp().orientation === "portrait";
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["to", "amount", "memo", "send"] as const);
  const pts = useAnchors(box, refs);

  const to = typed(RECIPIENT, frame, TO + 4, TO + 34);
  const amount = typed("12.5", frame, AMT + 4, AMT + 14);
  const memo = typed("Rent for May", frame, MEMO + 4, MEMO + 26);
  const isPrivate = to.length > 12;
  const sent = frame >= SUBMIT;
  const tpot = fmt4(interpolate(frame, [SUBMIT, SUBMIT + 30], [50, 37.4375], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const focusOn = (start: number, end: number) => frame >= start && frame < end;

  const pos = cursorAt(frame, portrait ? [620, 1200] : [1000, 900], [
    { start: 2, end: TO - 2, to: "to" },
    { start: TO + 36, end: AMT - 2, to: "amount" },
    { start: AMT + 14, end: MEMO - 2, to: "memo" },
    { start: MEMO + 28, end: BTN - 2, to: "send" },
  ], pts);

  return (
    <AppBox ref={box}>
      <BrowserFrame active="pay" account={ACCOUNT}>
        <PageHeading title="Pay" description="Pay anyone, request money, or split a bill." />
        <SubTabs items={["Send", "Request", "Split a bill", "My requests"]} active={0} />
        <Grid>
          <Card>
            <CardTitle>Send</CardTitle>
            <Hint>Pay a private address (umbra-addr-…) to keep the recipient hidden, or a public 5…/0x address for an ordinary transfer.</Hint>
            <Label>To</Label>
            <Anchor r={refs.to} block>
              <Field value={to} mono placeholder="Private address (umbra-addr-…), Portaldot 5… or 0x address" focused={focusOn(TO, AMT)} caret={focusOn(TO, AMT) && caretOn(frame)} style={{ minHeight: 52, fontSize: 14 }} />
            </Anchor>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label>Amount</Label>
                <Anchor r={refs.amount} block><Field value={amount} placeholder="0.0" focused={focusOn(AMT, MEMO)} caret={focusOn(AMT, MEMO) && caretOn(frame)} /></Anchor>
              </div>
              <div>
                <Label>Asset</Label>
                <Field value={<span style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>tPOT <span style={{ color: L.muted }}>▾</span></span>} style={{ display: "block" }} />
              </div>
            </div>
            {isPrivate && (
              <>
                <Label>Note (encrypted, only they can read it)</Label>
                <Anchor r={refs.memo} block><Field value={memo} placeholder="Dinner" focused={focusOn(MEMO, BTN)} caret={focusOn(MEMO, BTN) && caretOn(frame)} /></Anchor>
                <ToolbarLabel style={{ marginTop: 14, marginBottom: 8 }}>Pay from</ToolbarLabel>
                <ChipRow items={[`Private balance (${tpot} tPOT)`, "Wallet"]} active={0} />
                <PrivacyNote>Hidden: who receives and how much.</PrivacyNote>
                <PrivacyNote style={{ marginTop: 0 }}>Umbra's relayer submits this transaction, so your wallet does not sign it. Withdrawal addresses and amounts remain public, and timing can still link activity. Fee: 0.0625 tPOT, taken from your private balance.</PrivacyNote>
              </>
            )}
            <div style={{ marginTop: 6 }}>
              <Anchor r={refs.send}>
                <PrimaryButton pressed={isPressing(frame, BTN)} disabled={!amount}>{frame >= BTN && !sent ? "Working…" : "Send privately"}</PrimaryButton>
              </Anchor>
            </div>
            <StatusSeq
              frame={frame}
              steps={[
                { at: PROOF, kind: "info", text: MSG.proof, shimmer: true },
                { at: PROOF + 104, kind: "info", text: MSG.contacting },
                { at: PROOF + 140, kind: "info", text: MSG.submitting },
                { at: SUBMIT, kind: "ok", text: <>Sent privately · relayed in block <span style={{ fontFamily: font.mono }}>0x4c1e…7a90</span> <span style={{ fontWeight: 600, textDecoration: "underline" }}>view ↗</span></> },
              ]}
            />
          </Card>
          <AccountCard frame={frame} tpot={tpot} pusd="0.0000" popAt={sent ? SUBMIT : undefined} highlight="tpot" />
        </Grid>
      </BrowserFrame>
      {frame < BTN + 14 && (
        <Cursor x={pos[0]} y={pos[1]} clicking={[TO, AMT, MEMO, BTN].some((f) => isPressing(frame, f))} ripple={Math.max(...[TO, AMT, MEMO, BTN].map((f) => clickRipple(frame, f)))} />
      )}
    </AppBox>
  );
};
