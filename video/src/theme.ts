// Umbra brand tokens, lifted verbatim from frontend/src/styles.css.
// Light and dark share the structure; the app scenes render light, the cover/outro dark.

export const brand = {
  brand: "#14523b",
  brandDeep: "#0b2e21",
  accent: "#1d7f57",
  accentHover: "#176a48",
  mint: "#8fd6b1",
};

export const light = {
  bg: "#f5f7f5",
  surface: "#ffffff",
  surface2: "#f0f3f1",
  surface3: "#e8ede9",
  ink: "#0f1a14",
  ink2: "#34413a",
  muted: "#66716b",
  border: "#e1e6e2",
  borderStrong: "#cbd4cd",
  brand: brand.brand,
  brandDeep: brand.brandDeep,
  accent: brand.accent,
  accentHover: brand.accentHover,
  accentSoft: "#e6f3ec",
  accentInk: "#0f4f35",
  mint: brand.mint,
  danger: "#b0353c",
  warn: "#8a5d0e",
  warnSoft: "#fff5e1",
};

export const dark = {
  bg: "#0c1210",
  surface: "#131b17",
  surface2: "#18221d",
  surface3: "#1f2b25",
  ink: "#eaf1ed",
  ink2: "#c3cec8",
  muted: "#8e9a94",
  border: "#25322b",
  borderStrong: "#33443b",
  brand: brand.brand,
  brandDeep: brand.brandDeep,
  accent: "#3cb37f",
  accentHover: "#4cc58f",
  accentSoft: "#163327",
  accentInk: "#9fe3c2",
  mint: brand.mint,
  danger: "#f08a8f",
  warn: "#f0c56b",
  warnSoft: "#33291a",
};

export const font = {
  body: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  display: '"Manrope", "DM Sans", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
};

// The deep-green hero gradient used on the real home hero + cover/outro.
export const heroGradient =
  "radial-gradient(120% 140% at 85% 20%, #1f6a4d 0%, #14523b 38%, #0b2e21 100%)";

export const radius = { sm: 8, r: 12, lg: 16, xl: 22 };

export const shadow = {
  sm: "0 1px 2px rgba(15,26,20,0.05)",
  md: "0 1px 2px rgba(15,26,20,0.04), 0 8px 24px rgba(15,26,20,0.08)",
  lg: "0 24px 60px rgba(15,26,20,0.22)",
};
