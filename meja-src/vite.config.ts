import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../assets/meja",
    emptyOutDir: true,
    rollupOptions: { input: "src/main.tsx", output: { entryFileNames: "meja.js", chunkFileNames: "meja-[name].js", assetFileNames: "meja.[ext]" } },
  },
});
