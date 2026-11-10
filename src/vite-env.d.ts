/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Neon Auth の URL（Neon の管理画面 > Auth で確認）。空ならお試しログインで動く */
  readonly VITE_NEON_AUTH_URL?: string;
  /** Render のサーバーの URL（例：https://runndesu-api.onrender.com）。空なら仮のAIで動く */
  readonly VITE_API_URL?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }