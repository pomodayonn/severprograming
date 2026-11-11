// IndexedDB（ブラウザの中のデータベース）を使うための共通部分。dao/ の各クラスがここを使う
// 担当：）
//
// 入れ物（オブジェクトストア）
//   subjects・learningItems・prerequisites・notes（部品と単語ごと）・tests（問題・受験・解答ごと）：Neon と同期する
//   materials（資料の情報）・materialContents（資料の中身）：端末だけ。同期しない
//   deletions：Neon にまだ伝えていない削除（SyncManager.pushChanges で送る）
//   meta：前回同期した日時など

export const DB_NAME = "runndesu";
const DB_VERSION = 1;

export type StoreName = "subjects" | "learningItems" | "prerequisites" | "notes" | "tests" | "materials" | "materialContents" | "deletions" | "meta";

let opening: Promise<IDBDatabase> | null = null;

/** データベースを開く（初めてのときは入れ物を作る） */
export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const s = db.createObjectStore("subjects", { keyPath: "subjectId" }); s.createIndex("studentId", "studentId");
      const i = db.createObjectStore("learningItems", { keyPath: "itemId" }); i.createIndex("subjectId", "subjectId"); i.createIndex("studentId", "studentId");
      const p = db.createObjectStore("prerequisites", { keyPath: ["itemId", "prereqItemId"] }); p.createIndex("itemId", "itemId"); p.createIndex("studentId", "studentId");
      const n = db.createObjectStore("notes", { keyPath: "noteId" }); n.createIndex("itemId", "itemId", { unique: true }); n.createIndex("studentId", "studentId");
      const t = db.createObjectStore("tests", { keyPath: "testId" }); t.createIndex("itemId", "itemId"); t.createIndex("studentId", "studentId");
      const m = db.createObjectStore("materials", { keyPath: "materialId" }); m.createIndex("itemId", "itemId");
      db.createObjectStore("materialContents"); // キーは資料ID、値は文字列か Blob
      const d = db.createObjectStore("deletions", { keyPath: ["table", "key"] }); d.createIndex("studentId", "studentId");
      db.createObjectStore("meta"); // キーは "lastSyncedAt:学生ID" など
    };
    req.onsuccess = () => {
      const db = req.result;
      // ほかのタブで新しい版に上げるとき・データベースを消すときは、閉じて次回開き直す
      db.onversionchange = () => { db.close(); opening = null; };
      db.onclose = () => { opening = null; };
      resolve(db);
    };
    req.onerror = () => { opening = null; reject(req.error); };
  });
  return opening;
}

const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

/** 1件読む */
export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}
/** 索引（index）で探す */
export async function getAllBy<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value)) as Promise<T[]>;
}
/** 全部読む */
export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}
/** 保存する（同じキーがあれば上書き）。key は keyPath がない入れ物だけで使う */
export async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(structuredClone(value), key); return done(tx);
}
/** まとめて保存する */
export async function putMany(store: StoreName, values: unknown[]): Promise<void> {
  if (!values.length) return;
  const db = await openDb(); const tx = db.transaction(store, "readwrite"); const os = tx.objectStore(store);
  values.forEach(v => os.put(structuredClone(v))); return done(tx);
}
/** 消す */
export async function del(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await openDb(); const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key); return done(tx);
}

/** Neon にまだ伝えていない削除を記録する（SyncManager.pushChanges で送る） */
export interface Deletion { table: string; key: string; studentId: string; at: string }
export async function recordDeletion(table: string, key: string, studentId: string): Promise<void> {
  if (!studentId) return; // 学生IDがない（ログイン前のお試しなど）ときは同期しない
  await put("deletions", { table, key, studentId, at: new Date().toISOString() } satisfies Deletion);
}