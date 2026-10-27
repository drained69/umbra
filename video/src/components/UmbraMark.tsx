import React from "react";

// The real umbra-mark.svg (green rounded square + pillar + crescent moon).
export const UmbraMark: React.FC<{ size?: number; radius?: number }> = ({ size = 64, radius = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ display: "block" }}>
    <rect x="1" y="1" width="62" height="62" rx={radius} fill="#163E31" />
    <path d="M18 19v19c0 8 6.3 14 14 14s14-6 14-14V19h-9v19a5 5 0 0 1-10 0V19z" fill="#F0F6E9" />
    <circle cx="43" cy="17" r="9" fill="#B9D998" />
    <path d="M43 8a9 9 0 0 0 0 18 12 12 0 0 1 0-18" fill="#163E31" />
  </svg>
);

// Brand lockup: mark + "umbra." with the accent-green period, exactly as the header renders it.
export const UmbraLockup: React.FC<{
  markSize?: number;
  fontSize?: number;
  color?: string;
  period?: string;
}> = ({ markSize = 32, fontSize = 21, color = "#0f1a14", period = "#1d7f57" }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <UmbraMark size={markSize} radius={9} />
    <strong
      style={{
        fontFamily: '"Manrope", sans-serif',
        fontWeight: 800,
        fontSize,
        letterSpacing: "-0.04em",
        color,
        lineHeight: 1,
      }}
    >
      umbra<span style={{ color: period }}>.</span>
    </strong>
  </div>
);
