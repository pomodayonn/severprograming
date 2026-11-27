/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Neon Auth の URL（Neon の管理画面 > Auth で確認）。空だとログインできない */
  readonly VITE_NEON_AUTH_URL?: string;
  /** Neon の Data API の URL（同期に使う）。空だと同期せず、データは端末の中だけ */
  readonly VITE_NEON_DATA_API_URL?: string;
  /** RenderのAIサーバーのURL。未設定時は開発環境のみ仮AIを使用できる */
  readonly VITE_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
/** 文字起こし用ファイルの版の名前（例：tesseract7.0.0-pdfjs6.5.438）。vite.config.ts が node_modules から読んで入れる */
declare const __OCR_VERSION__: string;
