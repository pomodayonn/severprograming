/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Neon Auth の URL（Neon の管理画面 > Auth で確認）。空だとログインできない */
  readonly VITE_NEON_AUTH_URL?: string;
  /** Render のサーバーの URL（例：https://runndesu-api.onrender.com）。空なら仮のAIで動く */
  readonly VITE_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
/** 文字起こし用ファイルの版の名前（例：tesseract7.0.0-pdfjs6.5.438）。vite.config.ts が node_modules から読んで入れる */
declare const __OCR_VERSION__: string;
