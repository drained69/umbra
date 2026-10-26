import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** A button that copies `value` and confirms it, so users know the copy worked. */
export default function CopyButton({ value, children, className, label, style }: { value: string; children: ReactNode; className?: string; label?: string; style?: CSSProperties }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed"); // clipboard blocked (permissions or an insecure context)
    }
  }

  return (
    <button type="button" className={className} style={style} onClick={copy} aria-label={label}>
      <span aria-live="polite">{state === "copied" ? "Copied ✓" : state === "failed" ? "Copy blocked" : children}</span>
    </button>
  );
}
