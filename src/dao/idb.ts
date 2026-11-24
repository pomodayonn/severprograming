// IndexedDB（ブラウザの中のデータベース）を使うための共通部分。dao/ の各クラスがここを使う
// 担当s
//
// 入れ物（オブジェクトストア）
//   subjects・learningItems・prerequisites・notes（部品と単語ごと）・tests（問題・受験・解答ごと）：Neon と同期する
//   materials（資料の情報）・materialContents（資料の中身）：端末だけ。同期しない
//   deletions：Neon にまだ伝えていない削除（SyncManager.pushChanges で送る）
//   meta：前回同期した日時・前回受け取った日時（11/23）など

// 前に使っていた "runndesu" という名前のデータベースは、services/db.ts の removeOldData() が消している
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

/**
 * この端末にある、その学生のデータを全部消す（ログアウトのときに「この端末のデータも消す」を選んだとき。11/21）
 * ・科目・学習項目・前提項目・ノート・テスト・まだ送っていない削除の記録・前回同期した日時
 * ・資料と中身（資料には学生IDの欄がないので、その学生の学習項目から探す）
 * ほかの学生のデータは消さない。Neon（アカウント）のデータも消さない（次にログインすれば受け取れる）
 */
export async function clearStudentData(studentId: string): Promise<void> {
  // 資料は学習項目IDでまとまっているので、学習項目を消す前に、その学生の学習項目IDを集めておく
  const itemIds = (await getAllBy<{ itemId: string }>("learningItems", "studentId", studentId)).map(i => i.itemId);
  for (const itemId of itemIds) {
    for (const m of await getAllBy<{ materialId: string }>("materials", "itemId", itemId)) {
      await del("materials", m.materialId);
      await del("materialContents", m.materialId);
    }
  }
  // 学生IDの索引がある入れ物は、その学生の分をまとめて消す（キーの種類は入れ物ごとに違うので getAllKeys で取る）
  const db = await openDb();
  for (const store of ["subjects", "learningItems", "prerequisites", "notes", "tests", "deletions"] as const) {
    const keys = await wrap(db.transaction(store).objectStore(store).index("studentId").getAllKeys(studentId));
    for (const key of keys) await del(store, key);
  }
  await del("meta", `lastSyncedAt:${studentId}`);
  await del("meta", `lastPulledAt:${studentId}`); // 11/23：次にログインしたとき、必ず受け取り直すように
  await del("meta", `noteBases:${studentId}`);    // 11/24：ノートの食い違いを見分けるための記録
  await del("meta", `noteConflicts:${studentId}`);
}

/** replaceStudentData で入れ替える入れ物（学生IDの索引があり、Neon と同期するもの） */
export type SyncedStore = "subjects" | "learningItems" | "prerequisites" | "notes" | "tests";

/**
 * その学生の同期データを、受け取った内容にまるごと入れ替える（11/23）。
 * 「古い分を消す」「新しい分を入れる」「同期した時刻を書く」を1つのトランザクションでするので、
 * 途中でタブを閉じたりエラーになったりしても、全部入れ替わるか、何も変わらないかのどちらかになる
 * （Java の JDBC で setAutoCommit(false) → 最後に commit、失敗したら rollback するのと同じ考え方）
 * @param meta 同じトランザクションで meta に書く値（キー → 値）。前回同期した日時など
 */
export async function replaceStudentData(studentId: string, data: Record<SyncedStore, unknown[]>, meta: Record<string, unknown> = {}): Promise<void> {
  const stores = Object.keys(data) as SyncedStore[];
  const db = await openDb(); const tx = db.transaction([...stores, "meta"], "readwrite");
  for (const store of stores) {
    const os = tx.objectStore(store);
    const req = os.index("studentId").getAllKeys(studentId);
    // 消し終わってから入れる（先に入れると、同じキーの新しい行まで消してしまうため、getAllKeys の結果を待つ）
    req.onsuccess = () => {
      for (const key of req.result) os.delete(key);
      for (const v of data[store]) os.put(structuredClone(v));
    };
  }
  const ms = tx.objectStore("meta");
  for (const [k, v] of Object.entries(meta)) ms.put(v, k);
  return done(tx);
}

/** Neon にまだ伝えていない削除を記録する（SyncManager.pushChanges で送る） */
export interface Deletion { table: string; key: string; studentId: string; at: string }
export async function recordDeletion(table: string, key: string, studentId: string): Promise<void> {
  if (!studentId) return; // 学生IDがない（ログイン前など）ときは同期しない
  await put("deletions", { table, key, studentId, at: new Date().toISOString() } satisfies Deletion);
}