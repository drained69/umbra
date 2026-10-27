import React, { useRef } from "react";
import { useCurrentFrame } from "remotion";
import { BrowserFrame, Grid, PageHeading } from "../components/BrowserFrame";
import { SceneLayout, type Orientation } from "../components/Stage";
import { Caption } from "../components/Caption";
import { Cursor } from "../components/Cursor";
import { AppBox, Anchor, useAnchors, useRefs, useApp } from "../components/context";
import { Card, CardTitle, Hint, Label, Field, PrimaryButton, PrivacyMeter } from "../components/ui";
import { light as L } from "../theme";
import { typed, cursorAt, clickRipple, isPressing, countUp, caretOn } from "../anim";
import { cueLocal } from "../timing.mjs";
import { ACCOUNT, PrivacyNav } from "./Account";
import { AccountCard, ChipRow, MSG, StatusSeq, WalletSheet } from "./shared";

const CONFIRM = cueLocal("depositConfirm"); // beat 21
const FIELD = 42;
const BTN = 100;
const SHEET = 196;
const SIGN = 296;

export const Deposit: React.FC<{ orientation: Orientation }> = ({ orientation }) => (
  <SceneLayout
    orientation={orientation}
    height={{ portrait: 1240 }}
    camera={[
      { at: 0, zoom: 1 },
      { at: 18, zoom: 1 },
      { at: FIELD + 2, zoom: 1.45, focus: [0.78, 0.78] },
      { at: BTN, zoom: 1.45, focus: [0.78, 0.84] },
      { at: SHEET - 6, zoom: 1.45, focus: [0.78, 0.88] },
      { at: SHEET + 18, zoom: 1.55, focus: [0.83, 0.3] },
      { at: SIGN + 4, zoom: 1.55, focus: [0.83, 0.3] },
      { at: CONFIRM - 14, zoom: 1.45, focus: [0.78, 0.88] },
      { at: CONFIRM + 4, zoom: 1.45, focus: [0.78, 0.88] },
      { at: CONFIRM + 30, zoom: 1.75, focus: [0.29, 0.4] },
    ]}
    caption={<Caption number="04" label="Shield" headline="Fund your private balance." support="Deposit 50 tPOT. The proof is made in your browser and verified on chain." />}
  >
    <DepositBody />
  </SceneLayout>
);

const DepositBody: React.FC = () => {
  const frame = useCurrentFrame();
  const portrait = useApp().orientation === "portrait";
  const box = useRef<HTMLDivElement>(null);
  const refs = useRefs(["amount", "deposit", "sign"] as const);
  const pts = useAnchors(box, refs);

  const amount = typed("50", frame, FIELD + 6, FIELD + 20);
  const done = frame >= CONFIRM;
  const bal = done ? countUp(frame, CONFIRM, CONFIRM + 34, 50) : "0";
  const txns = done ? 49 : 48; // example pool activity

  const pos = cursorAt(frame, portrait ? [600, 1150] : [980, 760], [
    { start: 12, end: FIELD - 2, to: "amount" },
    { start: FIELD + 26, end: BTN - 2, to: "deposit" },
    { start: SHEET + 24, end: SIGN - 2, to: "sign" },
  ], pts);

  return (
    <AppBox ref={box}>
      <BrowserFrame active="transfer" account={ACCOUNT}>
        <PrivacyNav />
        <PageHeading title="Private balance" description="Add funds, pay other private addresses and withdraw, without exposing your wallet." />
        <Grid>
          <AccountCard frame={frame} tpot={bal} pusd="0" popAt={done ? CONFIRM : undefined} highlight="tpot" />
          <Card>
            <CardTitle>Move private funds</CardTitle>
            <Hint>Deposit any amount, send to another private address, or withdraw to any wallet. Deposits are signed by your wallet. For sends and withdrawals, choose a relayer or submit from your wallet.</Hint>
            <PrivacyMeter level={2} label="Fair" title="Private pool activity" detail={`${txns} private transactions so far. Your payment blends in with them.`} />
            <ChipRow items={["Deposit", "Send privately", "Withdraw"]} active={0} />
            <ChipRow items={[`tPOT · ${bal}`, "pUSD · 0"]} active={0} style={{ marginTop: 12 }} />
            <Label style={{ marginTop: 16 }}>Amount in tPOT</Label>
            <Anchor r={refs.amount} block>
              <Field value={amount} placeholder="1.0" focused={frame >= FIELD && frame < BTN} caret={frame >= FIELD && frame < BTN && caretOn(frame)} />
            </Anchor>
            <div style={{ marginTop: 18 }}>
              <Anchor r={refs.deposit}>
                <PrimaryButton pressed={isPressing(frame, BTN)} disabled={!amount}>{frame >= BTN && !done ? "Working…" : "Deposit to private account"}</PrimaryButton>
              </Anchor>
            </div>
            <StatusSeq
              frame={frame}
              steps={[
                { at: BTN + 4, kind: "info", text: MSG.proof, shimmer: true },
                { at: SHEET - 4, kind: "info", text: MSG.confirmWallet },
                {
                  at: CONFIRM,
                  kind: "ok",
                  text: <>Deposited · deposit in block <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>0x8f3a…c21d</span> <span style={{ fontWeight: 600, textDecoration: "underline", color: L.accentInk }}>View block ↗</span></>,
                },
              ]}
            />
          </Card>
        </Grid>
      </BrowserFrame>
      <WalletSheet frame={frame} at={SHEET} until={SIGN + 14} signRef={refs.sign} pressed={isPressing(frame, SIGN)} amount="50 tPOT" />
      {frame < SIGN + 16 && (
        <Cursor x={pos[0]} y={pos[1]} clicking={isPressing(frame, FIELD) || isPressing(frame, BTN) || isPressing(frame, SIGN)} ripple={Math.max(clickRipple(frame, FIELD), clickRipple(frame, BTN), clickRipple(frame, SIGN))} />
      )}
    </AppBox>
  );
};
