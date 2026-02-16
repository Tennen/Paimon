import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: currentDir,
  base: "/admin/",
  plugins: [react()],
  css: {
    postcss: path.resolve(currentDir, "postcss.config.cjs")
  },
  resolve: {
    alias: {
      "@": path.resolve(currentDir, "./src")
    }
  },
  build: {
    outDir: path.resolve(currentDir, "../dist/admin-web"),
    emptyOutDir: true
  }
});
