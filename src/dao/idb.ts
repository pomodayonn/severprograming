// IndexedDB（ブラウザの中のデータベース）を使うための共通部分。dao/ の各クラスがここを使う
// 担当s
//
// 入れ物（オブジェクトストア）
//   subjects・learningItems・prerequisites・notes（部品と単語ごと）・tests（問題・受験・解答ごと）：Neon と同期する
//   materials（資料の情報）・materialContents（資料の中身）：端末だけ。同期しない
//   deletions：Neon にまだ伝えていない削除（SyncManager.pushChanges で送る）
//   meta：前回同期した日時など

// 名前を "runndesu" にすると、資料の中身用（services/db.ts）の古いデータベースとぶつかるので分ける
export const DB_NAME = "runndesu-data";
const DB_VERSION = 2; // 入れ物を足したり直したりしたら1つ上げる

export type StoreName = "subjects" | "learningItems" | "prerequisites" | "notes" | "tests" | "materials" | "materialContents" | "deletions" | "meta";

let opening: Promise<IDBDatabase> | null = null;

/** データベースを開く（初めてのときは入れ物を作る） */
export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // まだない入れ物だけ作る（途中まで作られたデータベースでも直せるように）
      const make = (name: StoreName, opts?: IDBObjectStoreParameters, idx: [string, boolean?][] = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const os = db.createObjectStore(name, opts);
        idx.forEach(([k, unique]) => os.createIndex(k, k, { unique: !!unique }));
      };
      make("subjects", { keyPath: "subjectId" }, [["studentId"]]);
      make("learningItems", { keyPath: "itemId" }, [["subjectId"], ["studentId"]]);
      make("prerequisites", { keyPath: ["itemId", "prereqItemId"] }, [["itemId"], ["studentId"]]);
      make("notes", { keyPath: "noteId" }, [["itemId", true], ["studentId"]]);
      make("tests", { keyPath: "testId" }, [["itemId"], ["studentId"]]);
      make("materials", { keyPath: "materialId" }, [["itemId"]]);
      make("materialContents"); // キーは資料ID、値は文字列か Blob
      make("deletions", { keyPath: ["table", "key"] }, [["studentId"]]);
      make("meta"); // キーは "lastSyncedAt:学生ID" など
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