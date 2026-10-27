import React from "react";
import { interpolate } from "remotion";

// macOS-style pointer that eases between points and shows a click ripple.
export const Cursor: React.FC<{
  x: number;
  y: number;
  clicking?: boolean;
  /** 0..1 click ripple progress */
  ripple?: number;
}> = ({ x, y, clicking = false, ripple = 0 }) => {
  const rippleR = interpolate(ripple, [0, 1], [0, 34], { extrapolateRight: "clamp" });
  const rippleO = interpolate(ripple, [0, 0.2, 1], [0, 0.4, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 50, pointerEvents: "none" }}>
      {ripple > 0 && ripple < 1 && (
        <div
          style={{
            position: "absolute",
            left: -rippleR,
            top: -rippleR,
            width: rippleR * 2,
            height: rippleR * 2,
            borderRadius: "50%",
            background: "rgba(29,127,87,0.35)",
            opacity: rippleO,
          }}
        />
      )}
      <svg
        width="26"
        height="30"
        viewBox="0 0 26 30"
        style={{
          filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.3))",
          transform: `scale(${clicking ? 0.86 : 1})`,
          transformOrigin: "top left",
        }}
      >
        <path d="M1 1 L1 22 L7 17 L11 27 L15 25 L11 15 L19 15 Z" fill="#fff" stroke="#0f1a14" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
};
