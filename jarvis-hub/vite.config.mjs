import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function stripCrossOrigin() {
  return {
    name: "strip-crossorigin",
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin/g, "");
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, "src/renderer-react"),
  base: "./",
  plugins: [react(), tailwindcss(), stripCrossOrigin()],
  build: {
    outDir: path.resolve(__dirname, "src/renderer/dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
