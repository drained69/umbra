import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { UmbraMark } from "./components/UmbraMark";
import { brand, font, heroGradient } from "./theme";
import "./fonts";

// Pitch deck for the DoraHacks form ("problem addressed; why Portaldot is essential; proof of
// product functionality; reasons for continued future support"). 1920×1080, one still per slide.
// Every figure comes from the README/docs or from read-only lookups of the live testnet.

export const SLIDE_COUNT = 11;

const M = 110; // page margin

const Frame: React.FC<{ n: number; tag: string; children: React.ReactNode }> = ({ n, tag, children }) => (
  <AbsoluteFill style={{ background: heroGradient, fontFamily: font.body, overflow: "hidden" }}>
    <style>{`*,*::before,*::after{box-sizing:border-box} h1,h2,h3,p{margin:0}`}</style>
    <AbsoluteFill style={{ background: "radial-gradient(55% 55% at 86% 8%, rgba(143,214,177,0.16), transparent 70%)" }} />
    <div style={{ position: "absolute", left: M, top: 64, display: "flex", alignItems: "center", gap: 14 }}>
      <UmbraMark size={44} radius={13} />
      <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.04em", color: "#fff" }}>
        umbra<span style={{ color: brand.mint }}>.</span>
      </strong>
    </div>
    <div style={{ position: "absolute", right: M, top: 70, color: brand.mint, fontSize: 22, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{tag}</div>
    <div style={{ position: "absolute", inset: `140px ${M}px 90px ${M}px`, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
    <div style={{ position: "absolute", left: M, right: M, bottom: 38, display: "flex", justifyContent: "space-between", color: "#8fb8a3", fontSize: 20 }}>
      <span>Portaldot Hacker House 2026 · umbrav1.up.railway.app</span>
      <span>{n} / {SLIDE_COUNT}</span>
    </div>
  </AbsoluteFill>
);

const H: React.FC<{ children: React.ReactNode; size?: number; style?: React.CSSProperties }> = ({ children, size = 76, style }) => (
  <h1 style={{ fontFamily: font.display, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.035em", color: "#fff", ...style }}>{children}</h1>
);
const Mint: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ color: brand.mint }}>{children}</span>;

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; light?: boolean }> = ({ children, style, light }) => (
  <div
    style={{
      padding: "26px 30px",
      borderRadius: 24,
      background: light ? "rgba(255,255,255,0.97)" : "rgba(6,22,16,0.62)",
      border: `1.5px solid ${light ? "rgba(255,255,255,0.6)" : "rgba(143,214,177,0.28)"}`,
      boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      ...style,
    }}
  >
    {children}
  </div>
);

const Bullet: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 34 }) => (
  <div style={{ display: "flex", gap: 18, alignItems: "flex-start", margin: "20px 0", color: "#e3f3ea", fontSize: size, lineHeight: 1.32 }}>
    <span style={{ flex: "none", width: 14, height: 14, marginTop: size * 0.46, borderRadius: "50%", background: brand.mint }} />
    <span>{children}</span>
  </div>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ fontFamily: font.mono, fontSize: "0.82em", color: brand.mint }}>{children}</span>;

// A cropped region of a 1920×1080 screenshot, shown in a rounded white frame.
const Shot: React.FC<{ file: string; crop: [number, number, number, number]; w: number; caption?: string; sub?: string; src?: [number, number] }> = ({ file, crop, w, caption, sub, src = [1920, 1080] }) => {
  const [cx, cy, cw, ch] = crop;
  const s = w / cw;
  const h = ch * s;
  return (
    <div style={{ width: w }}>
      <div style={{ width: w, height: h, borderRadius: 22, overflow: "hidden", background: "#f5f7f5", boxShadow: "0 28px 70px rgba(0,0,0,0.4)", position: "relative" }}>
        <img src={staticFile(`deck/${file}`)} style={{ position: "absolute", width: src[0] * s, height: src[1] * s, left: -cx * s, top: -cy * s }} />
      </div>
      {caption && <div style={{ marginTop: 20, color: "#fff", fontFamily: font.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", textAlign: "center" }}>{caption}</div>}
      {sub && <div style={{ marginTop: 8, color: "#cfe6d9", fontSize: 25, lineHeight: 1.35, textAlign: "center" }}>{sub}</div>}
    </div>
  );
};

const Stat: React.FC<{ n: string; label: string }> = ({ n, label }) => (
  <Card style={{ padding: "22px 26px" }}>
    <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 84, letterSpacing: "-0.04em", color: brand.mint, lineHeight: 1 }}>{n}</div>
    <div style={{ marginTop: 10, color: "#d9f2e4", fontSize: 25, lineHeight: 1.3 }}>{label}</div>
  </Card>
);

// ------------------------------------------------------------------ slides

const S1: React.FC = () => (
  <AbsoluteFill style={{ background: heroGradient, fontFamily: font.body }}>
    <style>{`*,*::before,*::after{box-sizing:border-box} h1,h2,h3,p{margin:0}`}</style>
    <AbsoluteFill style={{ background: "radial-gradient(60% 60% at 75% 30%, rgba(143,214,177,0.2), transparent 70%)" }} />
    <div style={{ position: "absolute", left: 150, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <UmbraMark size={104} radius={30} />
        <strong style={{ fontFamily: font.display, fontWeight: 800, fontSize: 96, letterSpacing: "-0.05em", color: "#fff" }}>
          umbra<span style={{ color: brand.mint }}>.</span>
        </strong>
      </div>
      <H size={112} style={{ lineHeight: 1 }}>
        Pay anyone.
        <br />
        <Mint>Hide everything.</Mint>
      </H>
      <p style={{ fontSize: 38, color: "#cdebdc", maxWidth: 1180, lineHeight: 1.35 }}>
        A zero-knowledge privacy layer for payments, payment requests and swaps on Portaldot V3.
      </p>
      <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
        {["Live on Portaldot V3 testnet", "tPOT + pUSD", "Portaldot Hacker House 2026"].map((t) => (
          <span key={t} style={{ padding: "12px 22px", borderRadius: 999, background: "rgba(6,22,16,0.6)", border: "1.5px solid rgba(143,214,177,0.35)", color: "#d9f2e4", fontSize: 25, fontWeight: 700 }}>{t}</span>
        ))}
      </div>
    </div>
  </AbsoluteFill>
);

const S2: React.FC = () => (
  <Frame n={2} tag="The problem">
    <div style={{ display: "grid", gridTemplateColumns: "720px 1fr", gap: 60, alignItems: "center" }}>
      <div>
        <H size={66}>Every payment on a public chain is <Mint>public forever.</Mint></H>
        <Bullet size={32}>One reused wallet is an open diary: a single payment exposes your salary, rent, savings and every shop you use.</Bullet>
        <Bullet size={32}>Businesses cannot pay staff, suppliers or customers without publishing their margins and treasury.</Bullet>
        <Bullet size={32}>So real commerce stays off-chain, and a payments chain stalls at the first serious use case.</Bullet>
      </div>
      <Shot file="02-problem-public-ledger.png" crop={[190, 160, 1540, 760]} w={920} caption="One wallet, traced across every transfer" sub="Anyone can follow it, forever." />
    </div>
  </Frame>
);

const Step: React.FC<{ n: string; title: string; text: React.ReactNode }> = ({ n, title, text }) => (
  <Card style={{ flex: 1, padding: "34px 34px" }}>
    <div style={{ display: "grid", placeItems: "center", width: 58, height: 58, borderRadius: 18, background: brand.mint, color: brand.brandDeep, fontFamily: font.display, fontWeight: 800, fontSize: 30 }}>{n}</div>
    <div style={{ marginTop: 22, fontFamily: font.display, fontWeight: 800, fontSize: 46, letterSpacing: "-0.02em", color: "#fff" }}>{title}</div>
    <div style={{ marginTop: 16, color: "#cfe6d9", fontSize: 32, lineHeight: 1.4 }}>{text}</div>
  </Card>
);

const S3: React.FC = () => (
  <Frame n={3} tag="The solution">
    <H size={70}>A private balance for <Mint>every Portaldot user.</Mint></H>
    <div style={{ display: "flex", gap: 28, marginTop: 52 }}>
      <Step n="1" title="Deposit once" text="From the Portaldot Extension or any EVM wallet. Public, and the only step your wallet signs." />
      <Step n="2" title="Use it privately" text="Pay, request, split bills and swap tPOT ↔ pUSD. Proofs are made in your browser; a relayer submits them." />
      <Step n="3" title="Withdraw anytime" text="To any address. A zero-knowledge proof shows you own funds in the pool without revealing which." />
    </div>
    <div style={{ display: "flex", gap: 16, marginTop: 46, flexWrap: "wrap" }}>
      {["One shared pool for tPOT and pUSD", "Encrypted notes and memos", "Payment links and QR codes", "Read-only viewing keys for auditors"].map((t) => (
        <span key={t} style={{ padding: "15px 28px", borderRadius: 999, background: "rgba(255,255,255,0.1)", border: "1.5px solid rgba(143,214,177,0.3)", color: "#e3f3ea", fontSize: 29, fontWeight: 600 }}>{t}</span>
      ))}
    </div>
  </Frame>
);

const S4: React.FC = () => (
  <Frame n={4} tag="Proof it works · the product">
    <H size={62}>A real app, <Mint>running today.</Mint></H>
    <div style={{ display: "flex", gap: 34, marginTop: 40, justifyContent: "space-between" }}>
      <Shot file="06-send-privately-relayer.png" crop={[300, 200, 880, 810]} w={540} caption="Send privately" sub="Encrypted note; a relayer submits it, so your wallet never signs." />
      <Shot file="07b-request-before-pay.png" crop={[236, 270, 880, 810]} w={540} caption="Get paid with a link" sub="Open a ?pay= link, see who and what for, pay privately." />
      <Shot file="08-private-swap-quote.png" crop={[250, 150, 880, 810]} w={540} caption="Swap tPOT ↔ pUSD" sub="Live quote, fee and price impact. It fills exactly or not at all." />
    </div>
  </Frame>
);

const S5: React.FC = () => (
  <Frame n={5} tag="How it works">
    <div style={{ display: "grid", gridTemplateColumns: "560px 1fr", gap: 56, alignItems: "center" }}>
      <div>
        <H size={58}>Proofs in the browser. <Mint>Verified on chain.</Mint></H>
        <Bullet size={30}>Balance = encrypted notes; each is a Poseidon commitment in an on-chain Merkle tree.</Bullet>
        <Bullet size={30}>Groth16 join-split proofs (~27.5k constraints) check ownership and value conservation.</Bullet>
        <Bullet size={30}>The relayer is bound into the proof: it can delay, never redirect funds.</Bullet>
      </div>
      <Shot file="03-architecture.png" crop={[0, 0, 1600, 900]} src={[1600, 900]} w={1060} />
    </div>
  </Frame>
);

const Cap: React.FC<{ title: string; text: React.ReactNode }> = ({ title, text }) => (
  <Card style={{ padding: "24px 28px" }}>
    <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 35, letterSpacing: "-0.02em", color: brand.mint, lineHeight: 1.15 }}>{title}</div>
    <div style={{ marginTop: 12, color: "#e3f3ea", fontSize: 27, lineHeight: 1.36 }}>{text}</div>
  </Card>
);

const S6: React.FC = () => (
  <Frame n={6} tag="Why Portaldot is essential">
    <H size={62}>Built on what Portaldot V3 <Mint>provides natively.</Mint></H>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22, marginTop: 34 }}>
      <Cap title="EVM + WASM + native pallets" text="One chain, three runtimes. Pools and verifiers run in EVM; a second verifier runs in ink!; swaps use native pallets." />
      <Cap title="BN254 precompiles" text={<>On-chain Groth16 verification through <Code>0x06–0x08</Code>: about 0.035 s of block weight per proof.</>} />
      <Cap title="Native accounts call EVM" text={<><Code>revive.call</Code> lets Portaldot Extension users deposit with their 5… account. No EVM wallet needed.</>} />
      <Cap title="pUSD as a first-class asset" text="The pallet-assets ERC-20 precompile shields pUSD (#7777): confidential stablecoin payments." />
      <Cap title="Native DEX, atomic batches" text={<>Private swaps settle on <Code>pallet-asset-conversion</Code> inside one <Code>utility.batchAll</Code>: it fills or nothing happens.</>} />
      <Cap title="Designed for its economics" text="Redesigned for Portaldot's storage deposits: fixed-pool deposit 8.96 → 0 tPOT, private transaction 12.8 → 7.68 tPOT." />
    </div>
    <Card style={{ marginTop: 26, padding: "20px 30px", display: "flex", alignItems: "center", gap: 20 }}>
      <span style={{ flex: "none", width: 14, height: 14, borderRadius: "50%", background: brand.mint }} />
      <span style={{ color: "#fff", fontSize: 30, lineHeight: 1.35 }}>
        Portaldot's whitepaper lists a <strong>ZKP-based privacy protection suite</strong> for compliant private commerce. Umbra ships it on the live chain.
      </span>
    </Card>
  </Frame>
);

const Tx: React.FC<{ block: string; title: string; text: string; hash: string }> = ({ block, title, text, hash }) => (
  <Card style={{ padding: "20px 26px", display: "flex", gap: 22, alignItems: "center" }}>
    <div style={{ flex: "none", width: 170, textAlign: "center", padding: "12px 0", borderRadius: 16, background: "rgba(143,214,177,0.14)" }}>
      <div style={{ color: "#8fb8a3", fontSize: 17, fontWeight: 800, letterSpacing: "0.1em" }}>BLOCK</div>
      <div style={{ color: brand.mint, fontFamily: font.display, fontWeight: 800, fontSize: 38, letterSpacing: "-0.02em" }}>{block}</div>
    </div>
    <div>
      <div style={{ color: "#fff", fontFamily: font.display, fontWeight: 800, fontSize: 32, letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ color: "#cfe6d9", fontSize: 25, marginTop: 4, lineHeight: 1.32 }}>{text}</div>
      <div style={{ color: "#8fb8a3", fontFamily: font.mono, fontSize: 19, marginTop: 6 }}>{hash}</div>
    </div>
  </Card>
);

const S7: React.FC = () => (
  <Frame n={7} tag="Proof it works · on chain and in tests">
    <H size={62}>Live on testnet. <Mint>Verified end to end.</Mint></H>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 36 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Stat n="75" label="Foundry contract tests, real Poseidon" />
        <Stat n="7" label="WASM verifier tests on the same real proofs" />
        <Stat n="30" label="end-to-end checks with real Groth16 proofs" />
        <Stat n="23" label="relayer checks: tampering, replays, fees" />
      </div>
      <div style={{ display: "grid", gap: 18 }}>
        <Tx block="169,320" title="Deployment begins" text="Poseidon hasher, deployed from the Portaldot Extension (revive.instantiateWithCode)" hash="ext 0x81c2d632…e9f7f" />
        <Tx block="215,672" title="Deposit into the private pool" text="Signed by the user's own account, revive.call" hash="ext 0xb6ebef2a…bacd" />
        <Tx block="215,680" title="First private swap, relayed" text="One atomic utility.batchAll. The trader's wallet never signed" hash="ext 0x0f6c108f…9af4" />
      </div>
    </div>
    <p style={{ marginTop: 30, color: "#cfe6d9", fontSize: 29, lineHeight: 1.4 }}>
      Plus live read-only suites against the deployed pool, including a real proof accepted by the deployed verifier. Open source: <strong style={{ color: "#fff" }}>github.com/drained69/umbra</strong>
    </p>
  </Frame>
);

const Row: React.FC<{ a: string; b: string; c: string }> = ({ a, b, c }) => (
  <div style={{ display: "grid", gridTemplateColumns: "360px 1fr 1fr", columnGap: 26, padding: "20px 0", borderBottom: "1px solid rgba(143,214,177,0.16)", fontSize: 27, lineHeight: 1.3 }}>
    <span style={{ color: "#fff", fontWeight: 700 }}>{a}</span>
    <span style={{ color: brand.mint }}>{b}</span>
    <span style={{ color: "#cfe6d9" }}>{c}</span>
  </div>
);

const S8: React.FC = () => (
  <Frame n={8} tag="Honest by design">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 720px", gap: 46, alignItems: "center" }}>
      <div>
        <H size={58}>Clear about what is hidden, <Mint>and what is not.</Mint></H>
        <div style={{ marginTop: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "360px 1fr 1fr", columnGap: 26, paddingBottom: 10, color: "#8fb8a3", fontSize: 19, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <span>Action</span><span>Hidden</span><span>Visible on chain</span>
          </div>
          <Row a="Deposit" b="Which notes it becomes" c="Depositor, asset, amount" />
          <Row a="Private payment" b="Sender, recipient, amount, note" c="That a private tx happened; the relayer" />
          <Row a="Private swap" b="Who traded" c="The relayer's trade on the exchange" />
          <Row a="Withdrawal" b="Which deposit it came from" c="Amount and receiving address" />
          <Row a="Request link" b="Everything, until paid" c="Nothing" />
        </div>
      </div>
      <Card style={{ alignSelf: "center" }}>
        <div style={{ color: brand.mint, fontSize: 21, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Known limits and the plan</div>
        <Bullet size={28}>Not independently audited. Two internal reviews, fixes covered by regression tests. Test tokens only.</Bullet>
        <Bullet size={28}>Single-contributor trusted setup, for demo use. Production needs a multi-party ceremony.</Bullet>
        <Bullet size={28}>Privacy grows with the crowd; a live meter in the app shows pool cover.</Bullet>
        <Bullet size={28}>Contracts are immutable with no admin keys. The relayer can censor, never steal.</Bullet>
      </Card>
    </div>
  </Frame>
);

const S9: React.FC = () => (
  <Frame n={9} tag="Reasons for continued support · value">
    <H size={62}>More than an app: <Mint>a privacy primitive for the ecosystem.</Mint></H>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 40 }}>
      <Card style={{ padding: "32px 32px" }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 42, color: brand.mint, letterSpacing: "-0.02em" }}>Reusable by every dApp</div>
        <div style={{ marginTop: 16, color: "#e3f3ea", fontSize: 31, lineHeight: 1.4 }}>A multi-asset shielded pool any Portaldot asset can join, plus a TypeScript SDK and a relayer other apps can plug into.</div>
      </Card>
      <Card style={{ padding: "32px 32px" }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 42, color: brand.mint, letterSpacing: "-0.02em" }}>Private, yet compliant</div>
        <div style={{ marginTop: 16, color: "#e3f3ea", fontSize: 31, lineHeight: 1.4 }}>Read-only viewing keys give accountants and auditors visibility without spend power. That is what real businesses need.</div>
      </Card>
      <Card style={{ padding: "32px 32px" }}>
        <div style={{ fontFamily: font.display, fontWeight: 800, fontSize: 42, color: brand.mint, letterSpacing: "-0.02em" }}>Built-in revenue</div>
        <div style={{ marginTop: 16, color: "#e3f3ea", fontSize: 31, lineHeight: 1.4 }}>Relayer fees on private transactions and a spread on private swaps pay for the service. Every new user and asset deepens everyone's privacy.</div>
      </Card>
    </div>
    <Card style={{ marginTop: 28, padding: "22px 32px" }}>
      <span style={{ color: "#fff", fontSize: 32, lineHeight: 1.4 }}>
        <strong style={{ color: brand.mint }}>Why it compounds:</strong> one anonymity set across tPOT, pUSD and future assets means each added user makes every payment harder to trace.
      </span>
    </Card>
  </Frame>
);

const Phase: React.FC<{ label: string; color: string; items: string[] }> = ({ label, color, items }) => (
  <Card style={{ flex: 1, padding: "28px 30px" }}>
    <div style={{ display: "inline-block", padding: "8px 18px", borderRadius: 999, background: color, color: brand.brandDeep, fontSize: 21, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
    <div style={{ marginTop: 10 }}>
      {items.map((t) => (
        <Bullet key={t} size={30}>{t}</Bullet>
      ))}
    </div>
  </Card>
);

const S10: React.FC = () => (
  <Frame n={10} tag="Reasons for continued support · roadmap">
    <H size={62}>From a working testnet beta <Mint>to real-funds privacy.</Mint></H>
    <div style={{ display: "flex", gap: 24, marginTop: 38 }}>
      <Phase label="Today" color={brand.mint} items={["Live on V3 testnet with real proofs", "Private payments, requests, bill splits, swaps", "Viewing keys, relayer, SDK, tests"]} />
      <Phase label="Next" color="#b9d998" items={["Batched private swaps that hide amounts", "Multi-party trusted-setup ceremony", "Independent professional audit", "Deploy the WASM second verifier"]} />
      <Phase label="Later" color="#d9f2e4" items={["Cross-chain transfers, Ethereum Sepolia ↔ Portaldot (prototype built)", "V3 Live: same EVM-capable runtime", "More Portaldot assets in the shared pool"]} />
    </div>
    <p style={{ marginTop: 34, color: "#e3f3ea", fontSize: 31, lineHeight: 1.4 }}>
      Support turns the demo into infrastructure: an audit, a real ceremony and relayer liquidity are the steps between this testnet beta and production.
    </p>
  </Frame>
);

const Link: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 22, padding: "14px 0", borderBottom: "1px solid rgba(143,214,177,0.2)" }}>
    <span style={{ width: 230, color: "#8fb8a3", fontSize: 22, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
    <span style={{ color: "#fff", fontFamily: font.display, fontWeight: 700, fontSize: 36, letterSpacing: "-0.01em" }}>{value}</span>
  </div>
);

// QR code for https://umbrav1.up.railway.app (29×29 modules, error correction M), generated with
// the same qrcode-generator library the app uses.
const QR_ROWS = ["11111110110100011010001111111", "10000010100110001001001000001", "10111010100010011011001011101", "10111010000110001101101011101", "10111010111110111101001011101", "10000010011000011000101000001", "11111110101010101010101111111", "00000000001111011001100000000", "10011111100001000101010010111", "01000001010101001011000110110", "10010111110001011110110100100", "01110101101101001101011111001", "10001010010001011001001000001", "11100101001001101100011111111", "01011110011111001011001000101", "01001100000010010001000010101", "10000110100000101011110101000", "10110100000001101011010010110", "11001011011000010001111011001", "11001001101110100011110101100", "11010111010011111101111111110", "00000000100000100011100011000", "11111110101100100111101011000", "10000010110100110101100010000", "10111010100101101001111111000", "10111010110110000000100000010", "10111010011000011010010110111", "10000010001101001011010111101", "11111110110110011001111011000"];

const Qr: React.FC<{ size: number }> = ({ size }) => {
  const n = QR_ROWS.length;
  const quiet = 4;
  const total = n + quiet * 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" style={{ display: "block" }}>
      <rect width={total} height={total} fill="#ffffff" />
      {QR_ROWS.map((row, y) => row.split("").map((c, x) => (c === "1" ? <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width="1.02" height="1.02" fill="#0b2e21" /> : null)))}
    </svg>
  );
};

const S11: React.FC = () => (
  <Frame n={11} tag="Try it now">
    <div style={{ display: "grid", gridTemplateColumns: "1fr 700px", gap: 60, alignItems: "center" }}>
      <div>
        <H size={92}>Pay anyone.<br /><Mint>Hide everything.</Mint></H>
        <div style={{ marginTop: 40 }}>
          <Link label="Live app" value="umbrav1.up.railway.app" />
          <Link label="Demo video" value="youtube.com/watch?v=hMTj8YFXGWM" />
          <Link label="Source code" value="github.com/drained69/umbra" />
        </div>
        <p style={{ marginTop: 26, color: "#cfe6d9", fontSize: 26 }}>Portaldot V3 testnet · test tokens only · MIT licensed</p>
      </div>
      <div style={{ justifySelf: "center", textAlign: "center" }}>
        <div style={{ padding: 26, borderRadius: 30, background: "#fff", boxShadow: "0 28px 70px rgba(0,0,0,0.4)", display: "inline-block" }}>
          <Qr size={500} />
        </div>
        <div style={{ marginTop: 24, color: "#fff", fontFamily: font.display, fontWeight: 800, fontSize: 40, letterSpacing: "-0.02em" }}>Scan to try it live</div>
        <div style={{ marginTop: 6, color: "#cfe6d9", fontSize: 26 }}>Portaldot Extension + testnet tPOT</div>
      </div>
    </div>
  </Frame>
);

const SLIDES: React.FC[] = [S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11];

export const Deck: React.FC<{ slide: number }> = ({ slide }) => {
  const Slide = SLIDES[Math.min(Math.max(slide, 0), SLIDES.length - 1)];
  return <Slide />;
};
