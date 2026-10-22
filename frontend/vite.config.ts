import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Alias the SDK source so the app and SDK share one copy of the note/merkle/proof logic.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@umbra/sdk": resolve(__dirname, "../sdk/src"),
    },
  },
  define: {
    // snarkjs references `global` in the browser
    global: "globalThis",
  },
  optimizeDeps: {
    exclude: ["snarkjs"],
  },
  server: { port: 5173 },
});
