import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative asset paths so dist can run under repo subpaths (e.g. GitHub Pages).
  base: "./",
  plugins: [react()],
  build: {
    outDir: "docs",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Keep stable names so root index.html can reference built assets directly.
        inlineDynamicImports: true,
        entryFileNames: "assets/index.js",
        chunkFileNames: "assets/index.js",
        assetFileNames: (assetInfo) => (assetInfo.name?.endsWith(".css") ? "assets/index.css" : "assets/[name][extname]"),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});
