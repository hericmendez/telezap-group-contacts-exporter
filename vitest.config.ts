import path from "node:path";
import { defineConfig } from "vitest/config";

// The app code uses the automatic JSX runtime (no React import); ensure
// Vitest transforms JSX the same way instead of React.createElement calls.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
