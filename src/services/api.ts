// サーバー（Render の ApiController）を呼ぶ窓口。やり取りの形は docs/API.md を参照。
// .env に VITE_API_URL があればサーバーに送り、なければ services/ai.ts の仮のAIで動く。
import { auth } from "./auth";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const SERVER = !!API_URL;

/** サーバーから返るエラーの種類（画面に出す文言はここで決める） */
export type ApiErrorCode = "UNAUTHORIZED" | "LIMIT_EXCEEDED" | "TOO_LONG" | "AI_UNAVAILABLE" | "BAD_REQUEST" | "NETWORK" | "SERVER";
const TEXT: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "ログインの期限が切れました。もう一度ログインしてください",
  LIMIT_EXCEEDED: "今日はこれ以上使えません",
  TOO_LONG: "送る内容が長すぎます。1万文字ごとに分けて送ってください",
  AI_UNAVAILABLE: "AIサービスが使えません。時間をおいて試してください",
  BAD_REQUEST: "送る内容に問題がありました。見直してください",
  NETWORK: "サーバーとつながりません。インターネットの接続を確認してください",
  SERVER: "サーバーでエラーが起きました。時間をおいて試してください",
};
export class ApiError extends Error {
  constructor(public code: ApiErrorCode, public status = 0) { super(TEXT[code]); }
}
/** 画面に出すエラー文。ApiError 以外（仮のAIの失敗など）は AI_UNAVAILABLE の文にする */
export const errorText = (e: unknown) => e instanceof ApiError ? e.message : TEXT.AI_UNAVAILABLE;

const byStatus = (s: number): ApiErrorCode => s === 401 ? "UNAUTHORIZED" : s === 429 ? "LIMIT_EXCEEDED" : s === 413 ? "TOO_LONG" : s === 400 ? "BAD_REQUEST" : s === 502 || s === 503 ? "AI_UNAVAILABLE" : "SERVER";

export async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError("SERVER");
  const token = await auth.getAccessToken();
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError("NETWORK"); }
  if (!res.ok) {
    let code: ApiErrorCode | undefined;
    try { code = ((await res.json()) as { error?: { code?: ApiErrorCode } }).error?.code; } catch { /* 本文なし */ }
    throw new ApiError(code && code in TEXT ? code : byStatus(res.status), res.status);
  }
  return res.json() as Promise<T>;
}