// TokenVerifier（Service／バックエンド）：ブラウザから届いた JWT（ログインの証明書）が本物か確かめ、学生IDを取り出す
//
// 【このファイルで何が起きているか】
// 1. Neon Auth の「ハンコの見本」（JWKS）の場所を .env の NEON_AUTH_JWKS_URL から読む
// 2. Authorization ヘッダーの「Bearer xxxxx」から JWT を取り出す
// 3. jose という部品で、ハンコ（署名）が本物か・期限が切れていないかを確かめる
// 4. 本物なら中の sub（= neon_auth.user の id = 学生ID）を返す。だめなら null
// Java でいうと、サーブレットの前に置くログインチェック用の Filter のような役です
import { createRemoteJWKSet, jwtVerify } from "jose";

export class TokenVerifier {
  /** @param {string | undefined} jwksUrl ハンコの見本の場所（NEON_AUTH_JWKS_URL） */
  constructor(jwksUrl) {
    // 見本は最初に使うときに取りに行き、しばらく覚えておいてくれる
    this.jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;
    if (!this.jwks) console.warn("NEON_AUTH_JWKS_URL がないので、ログインの確認がすべて失敗します");
  }

  /**
   * Authorization ヘッダーを確かめて、学生IDを返す。だめなら null
   * @param {string | undefined} authHeader 例："Bearer eyJhbGciOi..."
   * @returns {Promise<string | null>}
   */
  async verify(authHeader) {
    if (!this.jwks || !authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const { payload } = await jwtVerify(token, this.jwks); // 署名と期限（exp）を確かめる
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null; // 偽物・期限切れ・形がおかしい、のどれか
    }
  }
}