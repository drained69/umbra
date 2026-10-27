import React, { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { Orientation } from "./Stage";

// Each scene's app layout depends on orientation: landscape shows the desktop layout (1240px),
// portrait shows the app's own single-column layout (<960px breakpoint) at 860px wide.
export interface AppLayout {
  orientation: Orientation;
  appWidth: number;
  appHeight: number;
}
export const AppCtx = createContext<AppLayout>({ orientation: "landscape", appWidth: 1240, appHeight: 860 });
export const useApp = () => useContext(AppCtx);
export const isPortrait = () => useContext(AppCtx).orientation === "portrait";

// The app's coordinate space: browser frame + overlays + cursor share it, so they scale together.
export const AppBox = React.forwardRef<HTMLDivElement, { children: React.ReactNode }>(({ children }, ref) => {
  const { appWidth, appHeight } = useApp();
  return (
    <div ref={ref} style={{ position: "relative", width: appWidth, height: appHeight }}>
      {children}
    </div>
  );
});

// Wrap an element to make it a cursor target.
export const Anchor: React.FC<{ r: React.RefObject<HTMLSpanElement>; children: React.ReactNode; block?: boolean }> = ({ r, children, block }) => (
  <span ref={r} style={{ display: block ? "block" : "inline-block" }}>{children}</span>
);

export const useRefs = <K extends string>(keys: readonly K[]) => {
  const store = useRef<Record<string, React.RefObject<HTMLSpanElement>>>({});
  for (const k of keys) if (!store.current[k]) store.current[k] = React.createRef<HTMLSpanElement>();
  return store.current as Record<K, React.RefObject<HTMLSpanElement>>;
};

// Measure anchor centres in the container's intrinsic (unscaled) coordinates. Offsets ignore
// CSS transforms, so the camera's scaling never throws the cursor off its target.
export function useAnchors<K extends string>(
  container: React.RefObject<HTMLDivElement>,
  refs: Record<K, React.RefObject<HTMLSpanElement>>
): Partial<Record<K, [number, number]>> {
  const [pts, setPts] = useState<Partial<Record<K, [number, number]>>>({});
  const last = useRef<Partial<Record<K, [number, number]>>>({});
  useLayoutEffect(() => {
    const c = container.current;
    if (!c) return;
    const out: Partial<Record<K, [number, number]>> = { ...last.current };
    let changed = false;
    for (const k of Object.keys(refs) as K[]) {
      const el = refs[k].current;
      if (!el) continue;
      let x = 0;
      let y = 0;
      let n: HTMLElement | null = el;
      while (n && n !== c) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      if (n !== c) continue;
      const p: [number, number] = [Math.round(x + el.offsetWidth * 0.5), Math.round(y + el.offsetHeight * 0.55)];
      const prev = out[k];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) {
        out[k] = p;
        changed = true;
      }
    }
    if (changed) {
      last.current = out;
      setPts(out);
    }
  });
  return pts;
}
