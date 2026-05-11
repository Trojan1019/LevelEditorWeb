import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Use relative asset paths so dist can run under repo subpaths (e.g. GitHub Pages).
  base: "./",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
  },
});
