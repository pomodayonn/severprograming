// NeonAuthClient（Boundary／フロントエンド）：Neon Auth とやり取りする窓口。
// .env の VITE_NEON_AUTH_URL の Neon Auth（@neon/neon-js の auth）を使う。
// 11/22：Neon の準備ができる前に使っていた「お試しログイン」（端末の中だけで動くログイン）はなくした。
//   VITE_NEON_AUTH_URL が空のときは、ログイン・登録で「ログインの設定がありません」と出る
// 11/22：Student は types.ts の仮の形（id・email・createdAt）をやめて、src/beans/Student.ts（studentId・mail・registeredAt）を使う
//
// 【このファイルで何が起きているか】
// ログイン・登録・ログアウトを、Neon Auth（ログインの外部サービス）に頼む窓口です。
// パスワードは Neon Auth が持ち、アプリは見ない
// 流れの例（ログイン）：G001 画面 → Controller → AccountManager.login → ここの signIn → Neon Auth
// ログインに成功すると、Neon Auth がブラウザに「ログイン中」の印（セッション）を残す。
// 次にページを開いたときは getSession でその印を確かめるので、もう一度パスワードを入れなくてよい
import { Student } from "../beans/Student";
import { now } from "../beans/DateTime";

/** Neon Auth からの結果。失敗したときは画面に出す文を error に入れる */
export type AuthResult = { ok: true; student: Student } | { ok: false; error: string };

const MSG = {
  wrong: "メールアドレスまたはパスワードが違います", // どちらが違うかは示さない
  taken: "このメールアドレスは登録できません",
  weak: "パスワードは8〜16文字で、英字と数字の両方を含めてください",
  net: "通信できませんでした。時間をおいて試してください",
  noConfig: "ログインの設定がありません（.env の VITE_NEON_AUTH_URL を入れてください）",
};

// ---------- Neon Auth の型（@neon/neon-js の auth で使う分だけ） ----------
type NeonUser = { id: string; email: string; createdAt?: string | Date };
type NeonRes<T> = { data: T | null; error: { code?: string; message?: string; status?: number } | null };
interface NeonAuth {
  signUp: { email(a: { name: string; email: string; password: string }): Promise<NeonRes<{ user: NeonUser }>> };
  signIn: {
    email(a: { email: string; password: string }): Promise<NeonRes<{ user: NeonUser }>>;
    social(a: { provider: "google"; callbackURL: string }): Promise<unknown>;
  };
  signOut(): Promise<unknown>;
  getSession(): Promise<NeonRes<{ user: NeonUser; session: { token: string } }>>;
}
const toStudent = (u: NeonUser): Student => new Student({ studentId: u.id, mail: u.email, registeredAt: u.createdAt ? new Date(u.createdAt).toISOString() : now() });

export class NeonAuthClient {
  private client: NeonAuth | null = null;

  /** url は .env の VITE_NEON_AUTH_URL。空だとログインできない */
  constructor(private readonly url?: string) {}

  /** Neon Auth の URL が設定されているか（false ならログインも同期もできない） */
  get neon(): boolean { return !!this.url; }

  /** 登録する */
  async signUp(email: string, password: string): Promise<AuthResult> {
    if (!this.neon) return { ok: false, error: MSG.noConfig };
    try {
      const r = await (await this.auth()).signUp.email({ name: email.split("@")[0] || "User", email, password });
      return r.error || !r.data ? this.fail(r.error ?? {}, "up") : { ok: true, student: toStudent(r.data.user) };
    } catch (e) { return this.failThrown(e, "up"); }
  }

  /** ログインする */
  async signIn(email: string, password: string): Promise<AuthResult> {
    if (!this.neon) return { ok: false, error: MSG.noConfig };
    try {
      const r = await (await this.auth()).signIn.email({ email, password });
      return r.error || !r.data ? this.fail(r.error ?? {}, "in") : { ok: true, student: toStudent(r.data.user) };
    } catch (e) { return this.failThrown(e, "in"); }
  }

  /** Google でログインする（Neon の管理画面で Google ログインを有効にしておく）。ページが Google に移動し、戻ってきたら getSession で分かる */
  async signInWithGoogle(): Promise<void> {
    if (!this.neon) return; // 設定がないときは何もしない
    await (await this.auth()).signIn.social({ provider: "google", callbackURL: window.location.origin + window.location.pathname });
  }

  /** ログアウトする */
  async signOut(): Promise<void> {
    if (!this.neon) return;
    try { await (await this.auth()).signOut(); } catch { /* 端末側はログアウト扱いにする */ }
  }

  /** 今ログインしている学生を返す。いなければ null */
  async getSession(): Promise<Student | null> {
    if (!this.neon) return null;
    try { const r = await (await this.auth()).getSession(); return r.data?.user ? toStudent(r.data.user) : null; } catch { return null; }
  }

  /** サーバー（Render）に送る JWT（getSession() の session.token）。ログインしていなければ null */
  async getAccessToken(): Promise<string | null> {
    if (!this.neon) return null;
    try { const r = await (await this.auth()).getSession(); return r.data?.session?.token ?? null; } catch { return null; }
  }

  // ---------- ここから private ----------
  private async auth(): Promise<NeonAuth> {
    if (!this.client) { const { createAuthClient } = await import("@neon/neon-js/auth"); this.client = createAuthClient(this.url!) as unknown as NeonAuth; }
    return this.client;
  }
  /**
   * 例外として投げられたエラーを画面の文にする。
   * Neon Auth は、パスワード違い（401）などを「結果の error」ではなく AuthApiError という例外で投げてくる。
   * HTTP の番号（status）が分かるものは fail() と同じ決まりで文を選び、本当に通信できなかったときだけ MSG.net にする
   */
  private failThrown(e: unknown, kind: "in" | "up"): AuthResult {
    const x = (e ?? {}) as { name?: string; status?: number; code?: string; message?: string };
    if (typeof x.status === "number" || x.name === "AuthApiError") return this.fail({ status: x.status ?? 400, code: x.code, message: x.message }, kind);
    return { ok: false, error: MSG.net };
  }
  private fail(e: NonNullable<NeonRes<unknown>["error"]>, kind: "in" | "up"): AuthResult {
    const code = e.code ?? "";
    if (kind === "up" && (code.includes("ALREADY_EXISTS") || e.status === 422)) return { ok: false, error: MSG.taken };
    if (kind === "up" && code.includes("PASSWORD")) return { ok: false, error: MSG.weak };
    if (!e.status || e.status >= 500) return { ok: false, error: MSG.net };
    return { ok: false, error: kind === "in" ? MSG.wrong : MSG.taken };
  }
}

/** アプリ全体で1つだけ使う NeonAuthClient（AccountManager と、サーバーを呼ぶ services/api.ts が使う） */
export const neonAuthClient = new NeonAuthClient(import.meta.env.VITE_NEON_AUTH_URL || undefined);