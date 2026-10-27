import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { font, brand } from "../theme";
import { useApp } from "./context";

// A step caption: number · feature label · headline · one supporting line.
// Sized large for phone legibility. Light-on-dark by default (sits on the green stage).
export const Caption: React.FC<{
  number?: string;
  label: string;
  headline: string;
  support: string;
  align?: "left" | "center";
  delay?: number;
  compact?: boolean;
}> = ({ number, label, headline, support, align = "left", delay = 4, compact = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (useApp().orientation === "portrait") compact = true;
  const t = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.7 } });
  const y = interpolate(t, [0, 1], [26, 0]);
  const op = interpolate(frame, [delay, delay + 10], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        opacity: op,
        transform: `translateY(${y}px)`,
        textAlign: align,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 14,
        maxWidth: compact ? 940 : 520,
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        {number && (
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 44,
              height: 44,
              borderRadius: 14,
              background: brand.mint,
              color: brand.brandDeep,
              font: `800 20px/1 ${font.display}`,
            }}
          >
            {number}
          </span>
        )}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 14px",
            borderRadius: 999,
            border: "1px solid rgba(217,242,228,0.3)",
            color: "#cdebdc",
            font: `700 14px/1 ${font.body}`,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: font.display,
          fontWeight: 800,
          fontSize: compact ? 62 : 46,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          color: "#ffffff",
        }}
      >
        {headline}
      </h2>
      <p style={{ margin: 0, color: "#bfe0cf", fontSize: compact ? 28 : 21, lineHeight: 1.45, fontFamily: font.body }}>{support}</p>
    </div>
  );
};
