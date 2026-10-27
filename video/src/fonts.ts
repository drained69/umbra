import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// The app serves DM Sans (body) and Manrope (headings). We load the very same woff2
// files, so type in the video matches the product exactly.
export const fontsReady = Promise.all([
  loadFont({ family: "DM Sans", url: staticFile("fonts/dm-sans-latin.woff2"), weight: "400 700" }),
  loadFont({ family: "DM Sans", url: staticFile("fonts/dm-sans-latin-ext.woff2"), weight: "400 700" }),
  loadFont({ family: "Manrope", url: staticFile("fonts/manrope-latin.woff2"), weight: "600 800" }),
  loadFont({ family: "Manrope", url: staticFile("fonts/manrope-latin-ext.woff2"), weight: "600 800" }),
]);
