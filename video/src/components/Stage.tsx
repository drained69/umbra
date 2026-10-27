import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { heroGradient } from "../theme";
import { AppCtx } from "./context";

export type Orientation = "landscape" | "portrait";

// Deep-green stage with a drifting glow — the backdrop for every scene.
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 20;
  return (
    <AbsoluteFill style={{ background: heroGradient }}>
      <AbsoluteFill style={{ background: `radial-gradient(60% 50% at ${50 + drift / 6}% 18%, rgba(143,214,177,0.16), transparent 70%)` }} />
      <AbsoluteFill style={{ opacity: 0.5 }}>
        <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1920 1080">
          <circle cx={1680 + drift} cy="200" r="7" fill="#8fd6b1" opacity="0.5" />
          <circle cx="240" cy="820" r="4" fill="#d9f2e4" opacity="0.4" />
          <circle cx={1500 - drift} cy="900" r="3" fill="#d9f2e4" opacity="0.3" />
        </svg>
      </AbsoluteFill>
      {children}
    </AbsoluteFill>
  );
};

/** Camera push-in: zooms toward focus (fractions of the app) and drifts it toward centre. */
export type PushIn = { start: number; end: number; to: number; focus?: [number, number]; release?: number };

export const SceneLayout: React.FC<{
  orientation: Orientation;
  caption: React.ReactNode;
  children: React.ReactNode;
  height?: { landscape?: number; portrait?: number };
  pushIn?: PushIn;
}> = ({ orientation, caption, children, height, pushIn }) => {
  const frame = useCurrentFrame();
  const { fps, width, height: H } = useVideoConfig();
  const landscape = orientation === "landscape";

  const appWidth = landscape ? 1240 : 860;
  const appHeight = landscape ? height?.landscape ?? 860 : height?.portrait ?? 1060;

  // entrance: a slight pull-back that settles (reads as the camera arriving on a new step)
  const entrance = spring({ frame, fps, config: { damping: 200, mass: 0.9 } });
  const entranceScale = interpolate(entrance, [0, 1], [0.955, 1]);
  const entranceOp = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  let push = 1;
  let p = 0;
  if (pushIn) {
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    p = ease(interpolate(frame, [pushIn.start, pushIn.end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    if (pushIn.release !== undefined) {
      p *= 1 - ease(interpolate(frame, [pushIn.release, pushIn.release + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    }
    // portrait frames fill the width, so a gentler push keeps the sides on screen
    push = 1 + (pushIn.to - 1) * (landscape ? 1 : 0.45) * p;
  }
  const [fx, fy] = pushIn?.focus ?? [0.5, 0.4];
  // Pan the focus toward centre, clamped so the zoomed frame always covers its slot
  // (no frame edge ever slides into view mid-push).
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const grow = push - 1;
  const dx = clamp((0.5 - fx) * appWidth * p * 0.9, -(1 - fx) * appWidth * grow, fx * appWidth * grow);
  const dy = clamp((0.4 - fy) * appHeight * p * 0.9, -(1 - fy) * appHeight * grow, fy * appHeight * grow);

  const pad = landscape ? 76 : 60;
  const capW = landscape ? 600 : width - pad * 2;
  const capH = landscape ? undefined : 340;
  const gap = landscape ? 56 : 40;
  const regionW = landscape ? width - pad * 2 - capW - gap : width - pad * 2;
  const regionH = landscape ? H - pad * 2 : H - pad * 2 - (capH ?? 0) - gap;
  const base = Math.min(regionW / appWidth, regionH / appHeight);

  return (
    <AppCtx.Provider value={{ orientation, appWidth, appHeight }}>
      <AbsoluteFill style={{ display: "flex", flexDirection: landscape ? "row" : "column", alignItems: "center", padding: pad, gap }}>
        <div style={{ width: capW, height: capH, flex: "none", display: "flex", alignItems: landscape ? "center" : "flex-end" }}>{caption}</div>
        <div style={{ width: regionW, height: regionH, flex: "none", position: "relative", overflow: "hidden", opacity: entranceOp, borderRadius: 24 }}>
          <div
            style={{
              position: "absolute",
              left: (regionW - appWidth) / 2,
              top: (regionH - appHeight) / 2,
              width: appWidth,
              height: appHeight,
              transform: `scale(${base * entranceScale})`,
              transformOrigin: "50% 50%",
            }}
          >
            <div style={{ width: appWidth, height: appHeight, transformOrigin: `${fx * 100}% ${fy * 100}%`, transform: `translate(${dx}px, ${dy}px) scale(${push})` }}>
              {children}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AppCtx.Provider>
  );
};
