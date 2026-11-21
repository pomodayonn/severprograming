// お試しログインのアカウントを端末(localStorage)に保存する所。
//
// 【このファイルで何が起きているか】
// ・localAccounts / saveLocalAccounts：お試しログイン（Neon Auth を使わないとき）のアカウントを保存する
// ・sha：パスワードをそのまま保存しないための変換
// ・removeOldData：前の保存場所に残っているデータを消す
// 科目・ノート・テスト・資料は、すべて Manager（dao/idb.ts の "runndesu-data"）が保存する。
// 11/21（福山）：前はここにも保存していた（localStorage の「runndesu.data.学生ID」と IndexedDB の "runndesu"）。
//   引っ越しはやめた（チームでデータは消えてよいと決めた）ので、残っている分は removeOldData() で消す
import type { LocalAccount } from "../types";
const A = "runndesu.local-accounts";
export async function sha(s: string): Promise<string> {
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  catch { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return "f" + (h >>> 0).toString(16) + s.length; }
}
// localStorage が使えない環境（ブロックされている等）でも、そのままメモリで動くようにする
// 11/21：NeonAuthClient（お試しログインのセッション）も、自分で同じものを書かずにこれを使う
const mem = new Map<string, string>();
export const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } },
  set: (k: string, v: string) => { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* メモリには残る */ } },
  del: (k: string) => { mem.delete(k); try { localStorage.removeItem(k); } catch { /* 無視 */ } },
};
const read = <T,>(k: string, d: T): T => { try { const v = ls.get(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
/** お試しログインのアカウント（Neon Auth を使うときは使わない） */
export const localAccounts = () => read<LocalAccount[]>(A, []);
export const saveLocalAccounts = (a: LocalAccount[]) => ls.set(A, JSON.stringify(a));
/** 前の保存場所（localStorage の「runndesu.data.学生ID」と IndexedDB の "runndesu"）に残っているデータを消す。失敗しても何もしない */
export async function removeOldData(): Promise<void> {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("runndesu.data.")) localStorage.removeItem(k); } catch { /* localStorage が使えない */ }
  try { indexedDB.deleteDatabase("runndesu"); } catch { /* IndexedDB が使えない */ }
}
