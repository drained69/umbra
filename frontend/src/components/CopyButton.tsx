import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Clipboard feedback without putting sensitive values in notifications or logs. */
export default function CopyButton({ value, children, className = "", disabled = false, style, label }: { value: string; children: ReactNode; className?: string; disabled?: boolean; style?: CSSProperties; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timeout.current), []);
  async function copy() {
    clearTimeout(timeout.current);
    try { await navigator.clipboard.writeText(value); setState("copied"); }
    catch { setState("error"); }
    timeout.current = setTimeout(() => setState("idle"), 3500);
  }
  return <button type="button" className={className} style={style} aria-label={label} disabled={disabled} onClick={copy} aria-live="polite">{state === "copied" ? "Copied ✓" : state === "error" ? "Copy failed · retry" : children}</button>;
}
