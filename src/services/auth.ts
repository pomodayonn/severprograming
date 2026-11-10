// NeonAuthClient：ログインの窓口（クラス設計書の NeonAuthClient）。
// .env に VITE_NEON_AUTH_URL があれば Neon Auth を使い、なければ端末の中だけで動く「お試しログイン」を使う。
// 画面からはどちらでも同じ関数で呼べるので、Neon の準備ができたら .env を書くだけで切り替わる。
import type { Student } from "../types";
import { localAccounts, saveLocalAccounts, sha } from "./db";

export type AuthResult = { ok: true; student: Student } | { ok: false; error: string };
export interface AuthClient {
  /** Neon Auth を使っているか（false ならお試しログイン） */
  readonly neon: boolean;
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  /** Google でログイン（Neon Auth のときだけ）。ページが Google に移動し、戻ってきたら getSession で分かる */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<Student | null>;
  /** サーバー（Render）に送る JWT。ログインしていなければ null */
  getAccessToken(): Promise<string | null>;
}

const NEON_URL = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;
const msg = {
  wrong: "メールアドレスまたはパスワードが違います", // どちらが違うかは示さない
  taken: "このメールアドレスは登録できません",
  net: "通信できませんでした。時間をおいて試してください",
};

// ---------- Neon Auth ----------
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
const toStudent = (u: NeonUser): Student => ({ id: u.id, email: u.email, createdAt: u.createdAt ? new Date(u.createdAt).getTime() : Date.now() });

function neonClient(url: string): AuthClient {
  let client: NeonAuth | null = null;
  const get = async () => {
    if (!client) { const { createAuthClient } = await import("@neon/neon-js/auth"); client = createAuthClient(url) as unknown as NeonAuth; }
    return client;
  };
  const fail = (e: NonNullable<NeonRes<unknown>["error"]>, kind: "in" | "up"): AuthResult => {
    const code = e.code ?? "";
    if (kind === "up" && (code.includes("ALREADY_EXISTS") || e.status === 422)) return { ok: false, error: msg.taken };
    if (code.includes("PASSWORD") && kind === "up") return { ok: false, error: "パスワードは8〜16文字で、英字と数字の両方を含めてください" };
    if (!e.status || e.status >= 500) return { ok: false, error: msg.net };
    return { ok: false, error: kind === "in" ? msg.wrong : msg.taken };
  };
  return {
    neon: true,
    async signUp(email, password) {
      try { const r = await (await get()).signUp.email({ name: email.split("@")[0] || "User", email, password }); return r.error || !r.data ? fail(r.error ?? {}, "up") : { ok: true, student: toStudent(r.data.user) }; }
      catch { return { ok: false, error: msg.net }; }
    },
    async signIn(email, password) {
      try { const r = await (await get()).signIn.email({ email, password }); return r.error || !r.data ? fail(r.error ?? {}, "in") : { ok: true, student: toStudent(r.data.user) }; }
      catch { return { ok: false, error: msg.net }; }
    },
    async signInWithGoogle() { await (await get()).signIn.social({ provider: "google", callbackURL: window.location.origin + window.location.pathname }); },
    async signOut() { try { await (await get()).signOut(); } catch { /* 端末側はログアウト扱いにする */ } },
    async getSession() { try { const r = await (await get()).getSession(); return r.data?.user ? toStudent(r.data.user) : null; } catch { return null; } },
    // Neon のドキュメント（Auth > Plugins > JWT）では、getSession() の session.token が JWT。サーバーは JWKS で確認する
    async getAccessToken() { try { const r = await (await get()).getSession(); return r.data?.session?.token ?? null; } catch { return null; } },
  };
}

// ---------- お試しログイン（端末の中だけ） ----------
const SESSION = "runndesu.session";
const DEMO = { email: "demo@example.com", password: "demo1234" };
async function ensureDemo() {
  if (localAccounts().some(a => a.email === DEMO.email)) return;
  saveLocalAccounts([...localAccounts(), { id: "demo", email: DEMO.email, pass: await sha(DEMO.password), createdAt: Date.now() }]);
}
const getLs = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const setLs = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 無視 */ } };
let memSession: string | null = null;

function localClient(): AuthClient {
  const find = (id: string | null) => localAccounts().find(a => a.id === id) ?? null;
  const asStudent = (a: { id: string; email: string; createdAt: number }): Student => ({ id: a.id, email: a.email, createdAt: a.createdAt });
  const login = (id: string) => { memSession = id; setLs(SESSION, id); };
  return {
    neon: false,
    async signUp(email, password) {
      await ensureDemo();
      if (localAccounts().some(a => a.email === email)) return { ok: false, error: msg.taken };
      const a = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), email, pass: await sha(password), createdAt: Date.now() };
      saveLocalAccounts([...localAccounts(), a]); login(a.id); return { ok: true, student: asStudent(a) };
    },
    async signIn(email, password) {
      await ensureDemo();
      const h = await sha(password), a = localAccounts().find(x => x.email === email && x.pass === h);
      if (!a) return { ok: false, error: msg.wrong };
      login(a.id); return { ok: true, student: asStudent(a) };
    },
    async signInWithGoogle() { /* お試しログインでは使えない（画面にボタンを出さない） */ },
    async signOut() { memSession = null; setLs(SESSION, null); },
    async getSession() { await ensureDemo(); const a = find(memSession ?? getLs(SESSION)); return a ? asStudent(a) : null; },
    async getAccessToken() { return null; },
  };
}

export const auth: AuthClient = NEON_URL ? neonClient(NEON_URL) : localClient();
export const DEMO_ACCOUNT = DEMO;