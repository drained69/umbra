import React from "react";
import { light as L, font, radius, shadow } from "../theme";
import { UmbraLockup } from "./UmbraMark";
import { HomeIcon, WalletIcon, SendIcon, SwapIcon, PrivacyIcon } from "./ui";
import { useApp } from "./context";

export type NavId = "overview" | "wallet" | "pay" | "swap" | "transfer";
const NAV: { id: NavId; label: string; icon: React.FC }[] = [
  { id: "overview", label: "Home", icon: HomeIcon },
  { id: "wallet", label: "Wallet", icon: WalletIcon },
  { id: "pay", label: "Pay", icon: SendIcon },
  { id: "swap", label: "Swap", icon: SwapIcon },
  { id: "transfer", label: "Privacy", icon: PrivacyIcon },
];

export interface Account {
  initial: string;
  label: string;
  balance?: string;
}

// A browser window with the real Umbra header. Size comes from the scene layout, so the
// frame always fills its slot exactly (landscape desktop layout, portrait narrow layout).
export const BrowserFrame: React.FC<{
  active: NavId;
  account?: Account | null;
  connecting?: boolean;
  connectRef?: React.RefObject<HTMLSpanElement>;
  url?: string;
  children: React.ReactNode;
}> = ({ active, account, connecting, connectRef, url = "umbrav1.up.railway.app", children }) => {
  const { appWidth, appHeight, orientation } = useApp();
  const narrow = orientation === "portrait";
  return (
    <div
      style={{
        width: appWidth,
        height: appHeight,
        display: "flex",
        flexDirection: "column",
        borderRadius: radius.lg + 4,
        background: L.surface,
        boxShadow: shadow.lg,
        overflow: "hidden",
        border: `1px solid ${L.border}`,
      }}
    >
      {/* window chrome */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, height: 44, padding: "0 16px", background: L.surface2, borderBottom: `1px solid ${L.border}` }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 560,
            margin: "0 auto",
            height: 28,
            padding: "0 14px",
            borderRadius: 999,
            background: L.surface,
            border: `1px solid ${L.border}`,
            color: L.muted,
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={L.accent} strokeWidth="2.4" style={{ flex: "none" }}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{url}</span>
        </div>
        <div style={{ width: 52 }} />
      </div>

      {/* Umbra site header */}
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: narrow ? 14 : 28, height: 64, padding: narrow ? "0 18px" : "0 28px", background: L.surface, borderBottom: `1px solid ${L.border}` }}>
        <UmbraLockup markSize={32} fontSize={21} color={L.ink} period={L.accent} />
        <nav style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 0 }}>
          {NAV.map((item) => {
            const isActive = item.id === active;
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: narrow ? 6 : 8,
                  padding: narrow ? "8px 9px" : "8px 14px",
                  borderRadius: 999,
                  background: isActive ? L.accentSoft : "transparent",
                  color: isActive ? L.accentInk : L.muted,
                  font: `600 14px/1 ${font.body}`,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ display: "inline-flex", width: 18, height: 18 }}><Icon /></span>
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>
        <div style={{ display: "flex", alignItems: "center", flex: "none" }}>
          {account ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px 4px 4px", border: `1px solid ${L.border}`, borderRadius: 999, background: L.surface, fontSize: 13, fontWeight: 600, color: L.ink }}>
              <span style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", background: L.accentSoft, color: L.accentInk, fontWeight: 700, fontSize: 12 }}>{account.initial}</span>
              <span>{account.label}</span>
              {account.balance && !narrow && <small style={{ color: L.muted, fontWeight: 500 }}>{account.balance}</small>}
              <span style={{ color: L.muted, fontSize: 11 }}>▾</span>
            </div>
          ) : (
            <span ref={connectRef} style={{ display: "inline-block" }}>
              <div style={{ display: "inline-flex", alignItems: "center", padding: "11px 18px", borderRadius: radius.sm, background: L.accent, color: "#fff", font: `600 14px/1.1 ${font.body}`, boxShadow: shadow.sm, opacity: connecting ? 0.7 : 1, whiteSpace: "nowrap" }}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </div>
            </span>
          )}
        </div>
      </header>

      {/* page content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: narrow ? "26px 22px 30px" : "30px 28px 36px", background: L.bg }}>{children}</div>
    </div>
  );
};

// The app's 2-column panel grid; collapses to 1 column like the real app below 960px.
export const Grid: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => {
  const { orientation } = useApp();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: orientation === "portrait" ? "minmax(0,1fr)" : "minmax(0,1.15fr) minmax(0,0.85fr)",
        gap: orientation === "portrait" ? 16 : 20,
        alignItems: "start",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const PageHeading: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div style={{ marginBottom: 22 }}>
    <h1 style={{ margin: 0, fontFamily: font.display, fontSize: 30, fontWeight: 800, lineHeight: 1.15, color: L.ink, letterSpacing: "-0.02em" }}>{title}</h1>
    <p style={{ margin: "6px 0 0", color: L.muted, fontSize: 15 }}>{description}</p>
  </div>
);
