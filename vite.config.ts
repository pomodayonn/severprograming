import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2021",
    rollupOptions: {
      // React は画面の変更があってもほぼ変わらないので別ファイルにし、ブラウザのキャッシュを効かせる
      output: { manualChunks: { react: ["react", "react-dom"] } },
    },
  },
});
