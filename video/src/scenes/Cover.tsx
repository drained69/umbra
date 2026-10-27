import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { UmbraMark } from "../components/UmbraMark";
import { font, brand } from "../theme";
import { cueLocal } from "../timing.mjs";

// Frame 0 is the finished cover (logo centred, tagline below): platforms use it as the
// thumbnail. Then, under the opening line ("Every payment on a public chain is visible to
// everyone. Umbra changes that."), a public ledger shows one wallet traceable across every
// transfer; on "Umbra changes that" its fields scramble to hidden and the logo returns.
// The ledger is a video graphic with placeholder addresses, not Umbra UI.

const OUT = [16, 34]; // cover steps aside
const ROWS_IN = 30; // first ledger row
const TRACE = cueLocal("coverTrace"); // your wallet lights up across rows
const SCRAMBLE = cueLocal("coverScramble"); // "Umbra changes that" starts at 5.02 s
const HIDDEN = SCRAMBLE + 18;
const BACK = [182, 210]; // logo returns as the line ends (6.19 s)

const ME = "5Dw9…K2mf"; // placeholder wallet
const ROWS: [string, string, string, string][] = [
  ["4,182,301", ME, "5Gb3…Lq7c", "12.50 tPOT"],
  ["4,182,301", "5Hn1…8XtE", ME, "240.00 tPOT"],
  ["4,182,300", "5Fh2…9Qtp", "5Ck8…3WsA", "1,050.00 pUSD"],
  ["4,182,299", ME, "5Ey6…TqM4", "2.50 tPOT"],
  ["4,182,299", "5Gb3…Lq7c", "5Hn1…8XtE", "88.10 pUSD"],
  ["4,182,298", "5Ck8…3WsA", ME, "500.00 tPOT"],
];

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789#%&";
// Integer hash so scrambled glyphs look random (no repeating patterns); changes at 15 fps.
const hash = (a: number, b: number, c: number) => {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b) ^ Math.imul(c + 13, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
};
const scramble = (text: string, frame: number, seed: number) =>
  text
    .split("")
    .map((c, i) => (c === " " || c === "…" || c === "." ? c : GLYPHS[hash(i, seed, Math.floor(frame / 2)) % GLYPHS.length]))
    .join("");

const clampI = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const Cell: React.FC<{ text: string; frame: number; seed: number; mine?: boolean; align?: "left" | "right" }> = ({ text, frame, seed, mine, align = "left" }) => {
  const traced = mine && frame >= TRACE && frame < HIDDEN;
  let shown = text;
  let color = "#eaf6ef";
  if (frame >= SCRAMBLE && frame < HIDDEN) {
    shown = scramble(text, frame, seed);
    color = brand.mint;
  } else if (frame >= HIDDEN) {
    shown = "● ● ● ● ●";
    color = brand.mint;
  }
  return (
    <span
      style={{
        justifySelf: align === "right" ? "end" : "start",
        padding: "4px 10px",
        borderRadius: 8,
        background: traced ? "rgba(240,138,143,0.22)" : "transparent",
        boxShadow: traced ? "inset 0 0 0 1.5px rgba(240,138,143,0.75)" : "none",
        color: traced ? "#ffd9db" : color,
        whiteSpace: "nowrap",
      }}
    >
      {shown}
    </span>
  );
};

const Ledger: React.FC<{ frame: number }> = ({ frame }) => {
  const { fps } = useVideoConfig();
  const inS = spring({ frame: frame - 22, fps, config: { damping: 200 } });
  const outT = interpolate(frame, BACK, [0, 1], clampI);
  const hidden = frame >= HIDDEN;
  return (
    <div
      style={{
        width: 1240,
        padding: "30px 36px 26px",
        borderRadius: 26,
        background: "rgba(6,22,16,0.72)",
        border: "1px solid rgba(143,214,177,0.22)",
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        opacity: interpolate(inS, [0, 1], [0, 1]) * (1 - outT),
        transform: `translateY(${interpolate(inS, [0, 1], [40, 0]) - outT * 30}px) scale(${1 - outT * 0.06})`,
        fontFamily: font.body,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: hidden ? brand.mint : "#f08a8f", boxShadow: `0 0 0 6px ${hidden ? "rgba(143,214,177,0.18)" : "rgba(240,138,143,0.18)"}` }} />
          <strong style={{ color: "#fff", fontFamily: font.display, fontSize: 30, letterSpacing: "-0.02em" }}>Public chain · latest transfers</strong>
        </div>
        <span
          style={{
            padding: "9px 16px",
            borderRadius: 999,
            fontWeight: 800,
            fontSize: 17,
            letterSpacing: "0.06em",
            color: hidden ? brand.brandDeep : "#3a1c1e",
            background: hidden ? brand.mint : "#f08a8f",
          }}
        >
          {hidden ? "HIDDEN WITH UMBRA" : "VISIBLE TO EVERYONE"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr 60px 1fr 1fr", columnGap: 16, padding: "0 6px 10px", color: "#8fb8a3", fontSize: 16, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid rgba(143,214,177,0.15)" }}>
        <span>Block</span><span>From</span><span /><span>To</span><span style={{ justifySelf: "end" }}>Amount</span>
      </div>
      {ROWS.map((r, i) => {
        const at = ROWS_IN + i * 9;
        const o = interpolate(frame, [at, at + 8], [0, 1], clampI);
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "170px 1fr 60px 1fr 1fr",
              columnGap: 16,
              alignItems: "center",
              padding: "13px 6px",
              borderBottom: i < ROWS.length - 1 ? "1px solid rgba(143,214,177,0.08)" : "none",
              opacity: o,
              transform: `translateX(${(1 - o) * -24}px)`,
              fontFamily: font.mono,
              fontSize: 25,
            }}
          >
            <span style={{ color: "#8fb8a3" }}>#{r[0]}</span>
            <Cell text={r[1]} frame={frame} seed={i * 3} mine={r[1] === ME} />
            <span style={{ color: "#8fb8a3", textAlign: "center" }}>→</span>
            <Cell text={r[2]} frame={frame} seed={i * 3 + 1} mine={r[2] === ME} />
            <Cell text={r[3]} frame={frame} seed={i * 3 + 2} align="right" />
          </div>
        );
      })}
    </div>
  );
};

const Lockup: React.FC<{ frame: number; mode: "cover" | "return" }> = ({ frame, mode }) => {
  const breathe = 1 + Math.sin(frame / 34) * 0.012;
  const t = mode === "cover" ? interpolate(frame, OUT, [0, 1], clampI) : 1 - interpolate(frame, BACK, [0, 1], clampI);
  const ring = interpolate(frame, mode === "cover" ? [0, 1] : [BACK[0], BACK[1] + 50], [0.7, 1.25], clampI);
  const ringO = mode === "return" ? interpolate(frame, [BACK[0], BACK[1] + 50], [0.4, 0], clampI) : 0;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 1 - t,
        transform: `scale(${1 - t * 0.12}) translateY(${-t * 30}px)`,
      }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <div style={{ position: "absolute", top: 84 - 160, left: "50%", marginLeft: -160, width: 320, height: 320, borderRadius: "50%", border: `1.5px solid ${brand.mint}`, opacity: ringO, transform: `scale(${ring})` }} />
        <div style={{ transform: `scale(${breathe})`, filter: "drop-shadow(0 20px 50px rgba(0,0,0,0.4))" }}>
          <UmbraMark size={168} radius={48} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 88, letterSpacing: "-0.05em", color: "#ffffff", lineHeight: 1 }}>
            umbra<span style={{ color: brand.mint }}>.</span>
          </strong>
          <div style={{ width: 220, height: 2, background: brand.mint, opacity: 0.8, borderRadius: 2 }} />
          <p style={{ margin: 0, fontFamily: font.body, fontSize: 30, color: "#cdebdc", letterSpacing: "0.01em" }}>Private payments on Portaldot</p>
        </div>
      </div>
    </div>
  );
};

export const Cover: React.FC = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const fit = Math.min(1.18, (width - 80) / 1240); // larger on 1080p; shrinks to fit portrait
  return (
    <AbsoluteFill>
      {frame < OUT[1] + 1 && <Lockup frame={frame} mode="cover" />}
      {frame >= 20 && frame <= BACK[1] && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ transform: `scale(${fit})` }}>
            <Ledger frame={frame} />
          </div>
        </AbsoluteFill>
      )}
      {frame >= BACK[0] && <Lockup frame={frame} mode="return" />}
    </AbsoluteFill>
  );
};
