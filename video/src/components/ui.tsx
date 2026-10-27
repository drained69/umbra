import React from "react";
import { light as L, font, radius, shadow } from "../theme";

// ---- App-faithful atoms (styles mirror frontend/src/styles.css, light theme) ----

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      padding: 24,
      border: `1px solid ${L.border}`,
      borderRadius: radius.lg,
      background: L.surface,
      boxShadow: shadow.sm,
      minWidth: 0,
      ...style,
    }}
  >
    {children}
  </div>
);

export const CardTitle: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <h2 style={{ margin: "0 0 6px", fontFamily: font.display, fontSize: 18, fontWeight: 700, color: L.ink, letterSpacing: "-0.02em", ...style }}>{children}</h2>
);

export const Hint: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <p style={{ margin: "0 0 14px", color: L.muted, fontSize: 14, lineHeight: 1.55, ...style }}>{children}</p>
);

export const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ margin: "14px 0 6px", color: L.ink2, fontSize: 13, fontWeight: 600, ...style }}>{children}</div>
);

export const ToolbarLabel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ color: L.muted, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", ...style }}>{children}</div>
);

export const Field: React.FC<{
  value?: React.ReactNode;
  placeholder?: string;
  focused?: boolean;
  caret?: boolean;
  mono?: boolean;
  style?: React.CSSProperties;
}> = ({ value, placeholder, focused, caret, mono, style }) => {
  const empty = value === undefined || value === "" || value === null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        minHeight: 44,
        padding: "10px 12px",
        border: `1px solid ${focused ? L.accent : L.borderStrong}`,
        borderRadius: radius.sm,
        background: L.surface,
        color: empty ? "rgba(102,113,107,0.75)" : L.ink,
        fontSize: 15,
        fontFamily: mono ? font.mono : font.body,
        boxShadow: focused ? `0 0 0 3px rgba(29,127,87,0.22)` : "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{empty ? placeholder : value}</span>
      {caret && (
        <span style={{ display: "inline-block", width: 2, height: 20, background: L.accent, marginLeft: 1, opacity: 0.9 }} />
      )}
    </div>
  );
};

export const PrimaryButton: React.FC<{ children: React.ReactNode; pressed?: boolean; disabled?: boolean; style?: React.CSSProperties }> = ({ children, pressed, disabled, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "11px 18px",
      border: `1px solid ${L.accent}`,
      borderRadius: radius.sm,
      background: pressed ? L.accentHover : L.accent,
      color: "#fff",
      font: `600 14px/1.1 ${font.body}`,
      boxShadow: shadow.sm,
      opacity: disabled ? 0.5 : 1,
      transform: pressed ? "scale(0.98)" : "none",
      ...style,
    }}
  >
    {children}
  </div>
);

export const GhostButton: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: "10px 14px",
      border: `1px solid ${L.borderStrong}`,
      borderRadius: radius.sm,
      background: L.surface,
      color: L.ink,
      font: `600 13.5px/1.1 ${font.body}`,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Chip: React.FC<{ children: React.ReactNode; active?: boolean; style?: React.CSSProperties }> = ({ children, active, style }) => (
  <div
    style={{
      padding: "8px 14px",
      border: `1px solid ${active ? L.accent : L.borderStrong}`,
      borderRadius: 999,
      background: active ? L.accentSoft : L.surface,
      color: active ? L.accentInk : L.ink2,
      font: `600 13px/1.1 ${font.body}`,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

export const PrivacyNote: React.FC<{ children: React.ReactNode; tone?: "private" | "plain"; style?: React.CSSProperties }> = ({ children, tone = "private", style }) => (
  <p
    style={{
      margin: "14px 0",
      padding: "10px 14px",
      borderLeft: `3px solid ${tone === "private" ? L.accent : L.borderStrong}`,
      borderRadius: `0 ${radius.sm}px ${radius.sm}px 0`,
      background: tone === "private" ? L.accentSoft : L.surface2,
      color: tone === "private" ? L.accentInk : L.ink2,
      fontSize: 13.5,
      lineHeight: 1.5,
      ...style,
    }}
  >
    {children}
  </p>
);

export const StatusLine: React.FC<{ kind: "ok" | "err" | "info"; children: React.ReactNode; style?: React.CSSProperties }> = ({ kind, children, style }) => {
  const map = {
    ok: { bg: L.accentSoft, fg: L.accentInk },
    err: { bg: "#fdeeee", fg: L.danger },
    info: { bg: "#ecf3fa", fg: "#2f5f8a" },
  }[kind];
  return (
    <div style={{ margin: "14px 0 0", padding: "12px 14px", borderRadius: radius.sm, background: map.bg, color: map.fg, fontSize: 14, lineHeight: 1.5, ...style }}>
      {children}
    </div>
  );
};

// Private balance tile (wallet + private-account cards).
export const BalanceTile: React.FC<{ label: string; amount: React.ReactNode; unit: string; highlight?: boolean; style?: React.CSSProperties }> = ({ label, amount, unit, highlight, style }) => (
  <div
    style={{
      minWidth: 0,
      padding: "16px 18px",
      border: `1px solid ${highlight ? "color-mix(in srgb, " + L.accent + " 35%, " + L.border + ")" : L.border}`,
      borderRadius: radius.r,
      background: highlight ? `linear-gradient(160deg, ${L.accentSoft}, ${L.surface} 70%)` : L.surface2,
      ...style,
    }}
  >
    <span style={{ color: L.muted, fontSize: 13, fontWeight: 600 }}>{label}</span>
    <strong style={{ display: "block", marginTop: 5, color: L.ink, font: `800 28px/1.2 ${font.display}`, letterSpacing: "-0.03em" }}>
      {amount} <small style={{ color: L.muted, font: `600 14px ${font.body}` }}>{unit}</small>
    </strong>
  </div>
);

// 4-segment privacy meter — matches PrivacyMeter.tsx (levels Very low / Low / Fair / Strong).
const METER_COLORS = [L.danger, L.warn, L.accent, L.accent];
export const PrivacyMeter: React.FC<{ level: 0 | 1 | 2 | 3; label: string; title: string; detail: string; style?: React.CSSProperties }> = ({ level, label, title, detail, style }) => {
  const color = METER_COLORS[level];
  return (
    <div style={{ margin: "16px 0", padding: "14px 16px", border: `1px solid ${L.border}`, borderRadius: radius.r, background: L.surface2, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: L.muted, fontWeight: 600 }}>
        <span>{title}</span>
        <strong style={{ color }}>{label}</strong>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, margin: "8px 0" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ height: 6, borderRadius: 999, background: i <= level ? color : L.surface3 }} />
        ))}
      </div>
      <p style={{ margin: 0, color: L.ink2, fontSize: 13.5, lineHeight: 1.5 }}>{detail}</p>
    </div>
  );
};

// ---- minimal nav icons (match the header's icon set in spirit) ----
const IconWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const HomeIcon = () => <IconWrap><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></IconWrap>;
export const WalletIcon = () => <IconWrap><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12h3" /></IconWrap>;
export const SendIcon = () => <IconWrap><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></IconWrap>;
export const SwapIcon = () => <IconWrap><path d="M7 4v13" /><path d="M4 14l3 3 3-3" /><path d="M17 20V7" /><path d="M20 10l-3-3-3 3" /></IconWrap>;
export const PrivacyIcon = () => <IconWrap><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></IconWrap>;
export const RequestIcon = () => <IconWrap><path d="M12 2v6" /><path d="M9 5l3-3 3 3" /><rect x="4" y="8" width="16" height="12" rx="2" /></IconWrap>;
export const KeyIcon = () => <IconWrap><circle cx="8" cy="8" r="4" /><path d="M11 11l8 8" /><path d="M16 16l2 2" /></IconWrap>;
export const ShieldIcon = () => <IconWrap><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M9 12l2 2 4-4" /></IconWrap>;
export const LockIcon = () => <IconWrap><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></IconWrap>;
