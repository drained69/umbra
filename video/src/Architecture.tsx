import React from "react";
import { AbsoluteFill } from "remotion";
import { UmbraMark } from "./components/UmbraMark";
import { brand, font, heroGradient } from "./theme";
import "./fonts";

// Architecture diagram for the DoraHacks submission (1600×900). Content follows the README's
// "How it works" section: browser prover, relayer, EVM pool + verifier, native-runtime batch.

const Box: React.FC<{ x: number; y: number; w: number; h: number; title: string; tag?: string; children?: React.ReactNode; tone?: "dark" | "light" }> = ({ x, y, w, h, title, tag, children, tone = "dark" }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      padding: "20px 22px",
      borderRadius: 22,
      background: tone === "dark" ? "rgba(6,22,16,0.62)" : "rgba(255,255,255,0.96)",
      border: `1.5px solid ${tone === "dark" ? "rgba(143,214,177,0.32)" : "rgba(255,255,255,0.6)"}`,
      boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
    }}
  >
    {tag && <div style={{ color: tone === "dark" ? brand.mint : brand.accent, fontSize: 14, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{tag}</div>}
    <div style={{ color: tone === "dark" ? "#fff" : "#0f1a14", fontFamily: font.display, fontWeight: 800, fontSize: 27, letterSpacing: "-0.02em", marginBottom: 12 }}>{title}</div>
    {children}
  </div>
);

const Item: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark = true }) => (
  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "9px 0", color: dark ? "#d9f2e4" : "#34413a", fontSize: 18, lineHeight: 1.35 }}>
    <span style={{ flex: "none", width: 8, height: 8, marginTop: 8, borderRadius: "50%", background: dark ? brand.mint : brand.accent }} />
    <span>{children}</span>
  </div>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ fontFamily: font.mono, fontSize: 16 }}>{children}</span>;

const Step: React.FC<{ x: number; y: number; n: string; children: React.ReactNode; w?: number }> = ({ x, y, n, children, w = 330 }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", gap: 10, alignItems: "flex-start" }}>
    <span style={{ flex: "none", display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: brand.mint, color: brand.brandDeep, fontWeight: 800, fontSize: 16 }}>{n}</span>
    <span style={{ color: "#fff", fontSize: 18, fontWeight: 600, lineHeight: 1.35 }}>{children}</span>
  </div>
);

export const Architecture: React.FC = () => (
  <AbsoluteFill style={{ background: heroGradient, fontFamily: font.body, overflow: "hidden" }}>
    <style>{`*,*::before,*::after{box-sizing:border-box}`}</style>

    <div style={{ position: "absolute", left: 60, top: 44, display: "flex", alignItems: "center", gap: 14 }}>
      <UmbraMark size={44} radius={13} />
      <span style={{ color: "#fff", fontFamily: font.display, fontWeight: 800, fontSize: 32, letterSpacing: "-0.03em" }}>How Umbra works</span>
    </div>

    {/* arrows */}
    <svg width="1600" height="900" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={brand.mint} />
        </marker>
      </defs>
      <g stroke={brand.mint} strokeWidth="3" fill="none" markerEnd="url(#ah)">
        <path d="M 500 250 L 1052 250" />
        <path d="M 500 470 C 585 470, 545 640, 612 640" />
        <path d="M 972 640 C 1010 640, 1010 640, 1052 640" />
        <path d="M 1300 560 L 1300 432" strokeDasharray="7 7" />
      </g>
    </svg>

    <Box x={60} y={130} w={440} h={560} title="Your browser" tag="Client · React + Umbra SDK">
      <Item>Spend key and encrypted notes stay on your device</Item>
      <Item>Notes commit to <Code>Poseidon(amount, pubKey, blinding, asset)</Code></Item>
      <Item>Groth16 proofs generated locally with snarkjs (multi-asset circuit, ~27.5k constraints)</Item>
      <Item>Notes encrypted to the owner: x25519 + XChaCha20-Poly1305</Item>
      <Item>Payment links, QR codes and bill splits; nothing published until paid</Item>
    </Box>

    <Box x={612} y={540} w={360} h={230} title="Relayer" tag="Liveness only">
      <Item>Checks every request exactly as the contract will</Item>
      <Item>Its address and fee are bound into the proof: it cannot redirect funds</Item>
    </Box>

    <Box x={1052} y={130} w={490} h={300} title="EVM · pallet-revive" tag="Portaldot V3 testnet">
      <Item>UmbraMultiAssetPool: one shielded pool for tPOT and pUSD</Item>
      <Item>Groth16 verifier on the BN254 precompiles</Item>
      <Item>Merkle tree of notes; nullifiers stop double spends</Item>
    </Box>

    <Box x={1052} y={560} w={490} h={210} title="Native runtime" tag="One atomic utility.batchAll">
      <Item>pallet-asset-conversion swap (private swaps)</Item>
      <Item>pUSD approve · <Code>revive.call pool.transact</Code></Item>
    </Box>

    <Step x={560} y={170} n="1">Deposit: the only step your wallet signs</Step>
    <Step x={560} y={420} n="2" w={300}>Proof + relay terms over HTTPS, no wallet signature</Step>
    <Step x={1320} y={478} n="3" w={240}>Relayer submits</Step>

    <div style={{ position: "absolute", left: 60, right: 60, bottom: 40, display: "flex", justifyContent: "space-between", color: "#9fc6b2", fontSize: 18 }}>
      <span>On chain: that a private transaction happened. Hidden: sender, recipient, amount, note.</span>
      <span>Live on Portaldot V3 testnet</span>
    </div>
  </AbsoluteFill>
);
