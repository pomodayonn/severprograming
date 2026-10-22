// 保存先。端末(localStorage / IndexedDB)をここにまとめた。サーバー保存に切り替えるときはここを差し替える。
// 資料と文字起こしは学生のブラウザの中(IndexedDB)だけに置き、サーバーには送らない。
import type { Account, Data } from "../types";
const A = "runndesu.accounts", S = "runndesu.session", D = (id: string) => `runndesu.data.${id}`;
export async function sha(s: string): Promise<string> {
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  catch { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return "f" + (h >>> 0).toString(16) + s.length; }
}
// localStorage が使えない環境（ブロックされている等）でも、そのままメモリで動くようにする
const mem = new Map<string, string>();
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } },
  set: (k: string, v: string) => { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* メモリには残る */ } },
  del: (k: string) => { mem.delete(k); try { localStorage.removeItem(k); } catch { /* 無視 */ } },
};
const read = <T,>(k: string, d: T): T => { try { const v = ls.get(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
export const accounts = () => read<Account[]>(A, []);
export const saveAccounts = (a: Account[]) => ls.set(A, JSON.stringify(a));
export const session = () => read<string | null>(S, null);
export const setSession = (id: string | null) => id ? ls.set(S, JSON.stringify(id)) : ls.del(S);
export const emptyData = (): Data => ({ subjects: [], materials: [], tests: [], usage: {} });
export const loadData = (id: string): Data => ({ ...emptyData(), ...read<Partial<Data>>(D(id), {}) });
export const saveData = (id: string, d: Data) => ls.set(D(id), JSON.stringify(d));
// ---- 資料の中身（IndexedDB）----
const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("runndesu", 1); r.onupgradeneeded = () => r.result.createObjectStore("blobs"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => { const db = await open(); return new Promise((res, rej) => { const r = f(db.transaction("blobs", mode).objectStore("blobs")); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
export const putBlob = (key: string, v: Blob | string) => tx("readwrite", s => s.put(v, key));
export const getBlob = (key: string) => tx<Blob | string | undefined>("readonly", s => s.get(key));
export const delBlob = (key: string) => tx("readwrite", s => s.delete(key));
