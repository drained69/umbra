import { interpolate, spring } from "remotion";

// Reveal 0..1 over [start, start+dur].
export const appear = (frame: number, start: number, dur = 10) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// Text typed out between [start, end].
export const typed = (text: string, frame: number, start: number, end: number) => {
  const n = Math.round(
    interpolate(frame, [start, end], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  );
  return text.slice(0, n);
};

// Blinking caret (on while typing, steady blink otherwise).
export const caretOn = (frame: number) => Math.floor(frame / 8) % 2 === 0;

// A springy rise-and-fade entrance; returns {opacity, translateY}.
export const riseIn = (frame: number, fps: number, start: number, distance = 20) => {
  const s = spring({ frame: frame - start, fps, config: { damping: 200, mass: 0.7 } });
  return { opacity: appear(frame, start, 10), y: interpolate(s, [0, 1], [distance, 0]) };
};

// Count a number up from 0 to `to` between [start, end], formatted to `dp` decimals.
export const countUp = (frame: number, start: number, end: number, to: number, dp = 2) => {
  const v = interpolate(frame, [start, end], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

// Ease a cursor from A to B over [start, end] (easeInOut).
export const moveCursor = (
  frame: number,
  start: number,
  end: number,
  a: [number, number],
  b: [number, number]
): [number, number] => {
  const t = interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
};

// Click ripple progress (0..1) around a click frame.
export const clickRipple = (frame: number, at: number, dur = 16) =>
  frame >= at && frame <= at + dur ? (frame - at) / dur : 0;

export const isPressing = (frame: number, at: number) => frame >= at && frame <= at + 6;

// Cursor along a chain of moves between measured anchors. A target that isn't mounted yet
// keeps the cursor where it is, so it never jumps to a stale or guessed position.
export type CursorSeg = { start: number; end: number; to: string };
export const cursorAt = (
  frame: number,
  home: [number, number],
  segs: CursorSeg[],
  pts: Partial<Record<string, [number, number]>>
): [number, number] => {
  let cur = home;
  for (const s of segs) {
    const target = pts[s.to] ?? cur;
    if (frame < s.start) return cur;
    if (frame <= s.end) return moveCursor(frame, s.start, s.end, cur, target);
    cur = target;
  }
  return cur;
};
