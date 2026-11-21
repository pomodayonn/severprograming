// サーバー（Render の ApiController）を呼ぶ窓口。やり取りの形は docs/API.md を参照。
// .env に VITE_API_URL があればサーバーに送り、なければ services/ai.ts の仮のAIで動く。
//
// 【このファイルで何が起きているか】
// サーバー（ Render）を呼ぶ窓口です。
// 1. ログインの JWT（本人だという証明）を Neon Auth から受け取り、Authorization に付ける
// 2. fetch でサーバーに送る
// 3. エラーなら、HTTP の番号（401・429 など）から画面に出す文を決めて ApiError にする
// VITE_API_URL が空のあいだは呼ばれず、services/ai.ts の仮のAIが答える
import { neonAuthClient } from "../boundary/NeonAuthClient";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const SERVER = !!API_URL;
/** AIの返事を待つ長さ（ミリ秒） */
const TIMEOUT_MS = 90_000;

/** サーバーから返るエラーの種類（画面に出す文言はここで決める） */
export type ApiErrorCode = "UNAUTHORIZED" | "LIMIT_EXCEEDED" | "TOO_LONG" | "AI_UNAVAILABLE" | "BAD_REQUEST" | "NETWORK" | "SERVER" | "OFFLINE" | "TIMEOUT";
const TEXT: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "ログインの期限が切れました。もう一度ログインしてください",
  LIMIT_EXCEEDED: "今日はこれ以上使えません",
  TOO_LONG: "送る内容が長すぎます。1万文字ごとに分けて送ってください",
  AI_UNAVAILABLE: "AIサービスが使えません。時間をおいて試してください",
  BAD_REQUEST: "送る内容に問題がありました。見直してください",
  NETWORK: "サーバーとつながりません。インターネットの接続を確認してください",
  SERVER: "サーバーでエラーが起きました。時間をおいて試してください",
  OFFLINE: "インターネットにつながっていません。つながってから、もう一度試してください（ノートの保存は端末にできます）",
  TIMEOUT: "AIの返事が来ませんでした（90秒）。時間をおいて、もう一度試してください。利用回数は減っていません",
};
export class ApiError extends Error {
  constructor(public code: ApiErrorCode, public status = 0) { super(TEXT[code]); }
}
/** 画面に出すエラー文。ApiError 以外（仮のAIの失敗など）は AI_UNAVAILABLE の文にする */
export const errorText = (e: unknown) => e instanceof ApiError ? e.message : TEXT.AI_UNAVAILABLE;

const byStatus = (s: number): ApiErrorCode => s === 401 ? "UNAUTHORIZED" : s === 429 ? "LIMIT_EXCEEDED" : s === 413 ? "TOO_LONG" : s === 400 ? "BAD_REQUEST" : s === 502 || s === 503 ? "AI_UNAVAILABLE" : "SERVER";

export async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError("SERVER");
  // 11/17：オフラインなら送らずにすぐ知らせる
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ApiError("OFFLINE");
  const token = await neonAuthClient.getAccessToken();
  let res: Response;
  // 11/17：90秒たっても返事がなければあきらめる（Render が寝ていると最初の1回は30秒ほどかかるので、それより長くしてある）
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch { throw new ApiError(ctl.signal.aborted ? "TIMEOUT" : navigator.onLine === false ? "OFFLINE" : "NETWORK"); }
  finally { clearTimeout(timer); }
  if (!res.ok) {
    let code: ApiErrorCode | undefined;
    try { code = ((await res.json()) as { error?: { code?: ApiErrorCode } }).error?.code; } catch { /* 本文なし */ }
    throw new ApiError(code && code in TEXT ? code : byStatus(res.status), res.status);
  }
  return res.json() as Promise<T>;
}