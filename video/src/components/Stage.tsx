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
    <AbsoluteFill style={{ background: heroGradient, overflow: "hidden" }}>
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

/**
 * Camera keyframe (scene-local frame). `zoom` is relative to the resting fit; `focus` is the
 * point of the app (fractions of its width/height) the camera looks at. As zoom grows, the
 * focus glides to screen centre and the caption steps aside; at zoom 1 the caption is back.
 */
export type CamKey = { at: number; zoom: number; focus?: [number, number] };

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function sampleCamera(keys: CamKey[], frame: number) {
  const ks = [...keys].sort((a, b) => a.at - b.at);
  const focusOf = (k: CamKey) => k.focus ?? [0.5, 0.45];
  if (frame <= ks[0].at) return { zoom: ks[0].zoom, focus: focusOf(ks[0]) };
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (frame <= b.at) {
      const t = ease((frame - a.at) / Math.max(1, b.at - a.at));
      const fa = focusOf(a), fb = focusOf(b);
      return { zoom: a.zoom + (b.zoom - a.zoom) * t, focus: [fa[0] + (fb[0] - fa[0]) * t, fa[1] + (fb[1] - fa[1]) * t] as [number, number] };
    }
  }
  const last = ks[ks.length - 1];
  return { zoom: last.zoom, focus: focusOf(last) };
}

export const SceneLayout: React.FC<{
  orientation: Orientation;
  caption: React.ReactNode;
  children: React.ReactNode;
  height?: { landscape?: number; portrait?: number };
  camera?: CamKey[];
}> = ({ orientation, caption, children, height, camera }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const landscape = orientation === "landscape";

  const appW = landscape ? 1240 : 860;
  const appH = landscape ? height?.landscape ?? 860 : height?.portrait ?? 1060;

  // Resting slot beside (landscape) or below (portrait) the caption.
  const pad = landscape ? 64 : 60;
  const capW = landscape ? 540 : W - pad * 2;
  const capH = landscape ? H - pad * 2 : 340;
  const gap = landscape ? 48 : 40;
  const slot = landscape
    ? { x: pad + capW + gap, y: pad, w: W - pad * 2 - capW - gap, h: H - pad * 2 }
    : { x: pad, y: pad + capH + gap, w: W - pad * 2, h: H - pad * 2 - capH - gap };
  const base = Math.min(slot.w / appW, slot.h / appH);

  // Camera. Portrait already fills the width, so its moves are gentler.
  const cam = sampleCamera(camera ?? [{ at: 0, zoom: 1 }], frame);
  const zoom = landscape ? cam.zoom : 1 + (cam.zoom - 1) * 0.45;
  const [fx, fy] = cam.focus;
  const settle = interpolate(spring({ frame, fps, config: { damping: 200, mass: 0.9 } }), [0, 1], [0.985, 1]);
  const s = base * zoom * settle;
  // How far the shot has left the caption layout. Portrait zooms in place below its caption.
  const blend = landscape ? clamp((zoom - 1) / 0.28, 0, 1) : 0;

  const restX = slot.x + (slot.w - appW * base) / 2 + fx * appW * base;
  const restY = slot.y + (slot.h - appH * base) / 2 + fy * appH * base;
  const centreX = W / 2;
  const centreY = landscape ? H / 2 : H * 0.52;
  const tx = restX + (centreX - restX) * blend;
  const ty = restY + (centreY - restY) * blend;

  // Keep the window on screen: if it is wider/taller than the frame it must cover it;
  // otherwise it stays inside with a margin. No other edge ever crops it.
  const fitAxis = (origin: number, size: number, screen: number) => {
    if (size >= screen) return clamp(origin, screen - size, 0);
    const m = Math.min(28, (screen - size) / 2); // centred if it only just fits
    return clamp(origin, m, screen - size - m);
  };
  const x = fitAxis(tx - fx * appW * s, appW * s, W);
  const y = landscape ? fitAxis(ty - fy * appH * s, appH * s, H) : Math.max(slot.y, fitAxis(ty - fy * appH * s, appH * s, H));

  const captionOp = 1 - blend;

  return (
    <AppCtx.Provider value={{ orientation, appWidth: appW, appHeight: appH }}>
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: pad,
            top: landscape ? pad : pad,
            width: capW,
            height: capH,
            display: "flex",
            alignItems: landscape ? "center" : "flex-end",
            opacity: captionOp,
            transform: `translateX(${landscape ? -40 * blend : 0}px)`,
          }}
        >
          {caption}
        </div>
        <div style={{ position: "absolute", left: x, top: y, width: appW, height: appH, transform: `scale(${s})`, transformOrigin: "0 0" }}>
          {children}
        </div>
      </AbsoluteFill>
    </AppCtx.Provider>
  );
};
