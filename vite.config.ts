import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { ocrVersion } from "./scripts/ocr-version.mjs";
export default defineConfig({
  plugins: [react()],
  // 文字起こし用ファイルの版の名前を、ocr.ts の __OCR_VERSION__ に入れる（置き場所の URL に使う）
  define: { __OCR_VERSION__: JSON.stringify(ocrVersion()) },
  build: {
    target: "es2021",
    rollupOptions: {
      // React は画面の変更があってもほぼ変わらないので別ファイルにし、ブラウザのキャッシュを効かせる
      output: { manualChunks: { react: ["react", "react-dom"] } },
    },
  },
});
