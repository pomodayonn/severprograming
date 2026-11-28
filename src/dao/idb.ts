// IndexedDB（ブラウザの中のデータベース）を使うための共通部分。dao/ の各クラスがここを使う
// 担当s
//
// 入れ物（オブジェクトストア）
//   subjects・learningItems・prerequisites・notes（部品と単語ごと）・tests（問題・受験・解答ごと）：Neon と同期する
//   materials（資料の情報）・materialContents（資料の中身）：端末だけ。同期しない
//   deletions：Neon にまだ伝えていない削除（SyncManager.pushChanges で送る）
//   meta：前回同期した日時・前回受け取った日時（11/23）など
import type { Material } from "../beans/Material";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import type { Link } from "../lib/logic";
import type { Test } from "../beans/Test";
import type { Subject } from "../beans/Subject";
import type { Note } from "../beans/Note";
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
/** SYNC-07b: 送信に使う6ストアの読み取り結果。 */
export interface PushSnapshot {
  subjects: Subject[];
  learningItems: LearningItem[];
  prerequisites: Prerequisite[];
  notes: Note[];
  tests: Test[];
  deletions: Deletion[];
}

/** 同じreadonlyトランザクションで全ストアを読み、完了後に返す。
 * HTTP通信はトランザクションの外で行う。差分抽出と参照検証は呼出側で行う。
 */
export async function readPushSnapshot(studentId: string): Promise<PushSnapshot> {
  const db = await openDb();
  const stores: StoreName[] = ["subjects", "learningItems", "prerequisites", "notes", "tests", "deletions"];
  const tx = db.transaction(stores, "readonly");
  const read = <T>(store: StoreName): Promise<T[]> => wrap(tx.objectStore(store).getAll());
  // すべてのリクエストをawait前に登録する。
  const [subjects, learningItems, prerequisites, notes, tests, deletions] = await Promise.all([
    read<Subject>("subjects"),
    read<LearningItem>("learningItems"),
    read<Prerequisite>("prerequisites"),
    read<Note>("notes"),
    read<Test>("tests"),
    wrap(tx.objectStore("deletions").index("studentId").getAll(studentId)) as Promise<Deletion[]>,
    done(tx),
  ]);
  return { subjects, learningItems, prerequisites, notes, tests, deletions };
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
/** 指定されたキーのデータを削除する */
export async function del(
  store: StoreName,
  key: IDBValidKey | IDBKeyRange
): Promise<void> {
  const db = await openDb();

  const tx = db.transaction(
    store,
    "readwrite"
  );

  tx.objectStore(store).delete(key);

  await done(tx);
}
/**
 * 資料情報とファイル本体を同時に保存する。
 * 所有者は端末に保存されている学習項目から取得する。
 */
export async function putMaterialWithContent(
  material: Material,
  content: Blob | string
): Promise<void> {
  const db = await openDb();

  const tx = db.transaction(
    ["learningItems", "materials", "materialContents"],
    "readwrite"
  );

  let missingOwner = false;

  const req = tx.objectStore("learningItems")
    .get(material.itemId);

  req.onsuccess = () => {
    const item = req.result as
      { studentId: string } | undefined;

    if (!item?.studentId) {
      missingOwner = true;
      tx.abort();
      return;
    }

    tx.objectStore("materials").put(
      structuredClone({
        ...material,
        studentId: item.studentId,
      })
    );

    tx.objectStore("materialContents").put(
      structuredClone(content),
      material.materialId
    );
  };

  try {
    await done(tx);
  } catch (e) {
    if (missingOwner) {
      throw new Error(
        "資料の学習項目または所有者が見つかりません"
      );
    }

    throw e;
  }
}

/** 資料情報とファイル本体を同時に削除する */
export async function deleteMaterialWithContent(
  materialId: string
): Promise<void> {
  const db = await openDb();

  const tx = db.transaction(
    ["materials", "materialContents"],
    "readwrite"
  );

  tx.objectStore("materials").delete(materialId);

  tx.objectStore("materialContents").delete(
    materialId
  );

  await done(tx);
}

/**
 * 文字起こしの内容と資料情報を同時に更新する。
 * 読み込み・存在確認・更新を同一トランザクションで行う。
 */
export async function updateMaterialText(
  materialId: string,
  text: string
): Promise<void> {
  const db = await openDb();

  const tx = db.transaction(
    ["materials", "materialContents"],
    "readwrite"
  );

  const materials = tx.objectStore("materials");
  const contents = tx.objectStore("materialContents");

  let failure: unknown;

  const req = materials.get(materialId);

  req.onsuccess = () => {
    try {
      const material = req.result as Material | undefined;

      if (!material) {
        throw new Error("資料が見つかりません");
      }

      if (
        material.fileType !== "text" &&
        material.fileType !== "transcript"
      ) {
        throw new Error(
          "直せるのは文字起こしだけです"
        );
      }

      materials.put({
        ...material,
        fileSize: new Blob([text]).size,
      });

      contents.put(text, materialId);

    } catch (e) {
      failure = e;
      tx.abort();
    }
  };

  try {
    await done(tx);
  } catch (e) {
    throw failure ?? e ?? new Error(
      "資料の更新に失敗しました"
    );
  }
}

/**
 * この端末にある、その学生のデータを全部消す（ログアウトのときに「この端末のデータも消す」を選んだとき。11/21）
 * ・科目・学習項目・前提項目・ノート・テスト・まだ送っていない削除の記録・前回同期した日時
 * ・資料と中身（学生IDで所有者を判定する。
 *   旧形式の資料は学習項目から所有者を確認する）
 * ほかの学生のデータは消さない。Neon（アカウント）のデータも消さない（次にログインすれば受け取れる）
 */
export async function clearStudentData(
  studentId: string
): Promise<void> {
  const db = await openDb();

  const stores = [
    "subjects",
    "learningItems",
    "prerequisites",
    "notes",
    "tests",
    "deletions",
  ] as const;

  const tx = db.transaction(
    [
      ...stores,
      "materials",
      "materialContents",
      "meta",
    ],
    "readwrite"
  );

  // 学習項目を消す前に、その学生の項目IDを取得する。
  const itemReq = tx.objectStore("learningItems")
    .index("studentId")
    .getAllKeys(studentId);

  itemReq.onsuccess = () => {
    const itemIds = new Set(itemReq.result);

    const materials = tx.objectStore("materials");

    const contents = tx.objectStore(
      "materialContents"
    );

    const req = materials.getAll();

    req.onsuccess = () => {
      for (const m of req.result as Material[]) {
        // 新しい資料は学生IDで判定する。
        // 旧形式は親の学習項目から所有者を判定する。
        const owned =
          m.studentId === studentId ||
          (!m.studentId && itemIds.has(m.itemId));

        if (!owned) continue;

        materials.delete(m.materialId);
        contents.delete(m.materialId);
      }
    };
  };

  // その学生の同期データを削除する。
  for (const store of stores) {
    const os = tx.objectStore(store);

    const req = os.index("studentId")
      .getAllKeys(studentId);

    req.onsuccess = () => {
      for (const key of req.result) {
        os.delete(key);
      }
    };
  }

  const meta = tx.objectStore("meta");

  meta.delete(`lastSyncedAt:${studentId}`);
  meta.delete(`lastPulledAt:${studentId}`);
  meta.delete(`noteBases:${studentId}`);
  meta.delete(`noteConflicts:${studentId}`);

  await done(tx);
}

/** replaceStudentData で入れ替える入れ物（学生IDの索引があり、Neon と同期するもの） */
export type SyncedStore = "subjects" | "learningItems" | "prerequisites" | "notes" | "tests";

/** SYNC-07c: 保存済みBeanの値を比較する。日時だけでなく入れ子の内容も比較する。
 * IndexedDBから取得する配列・プレーンオブジェクト・プリミティブを対象とする。
 * 想定外のオブジェクト形式は同一扱いせず、安全側に倒す。
 */
function sameStoredValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
  } else if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(k =>
    Object.prototype.hasOwnProperty.call(right, k) && sameStoredValue(left[k], right[k]));
}

/**
 * その学生の同期データを、受け取った内容にまるごと入れ替える（11/23）。
 * 「古い分を消す」「新しい分を入れる」「同期した時刻を書く」を1つのトランザクションでするので、
 * 途中でタブを閉じたりエラーになったりしても、全部入れ替わるか、何も変わらないかのどちらかになる
 * （Java の JDBC で setAutoCommit(false) → 最後に commit、失敗したら rollback するのと同じ考え方）
 * @param meta 同じトランザクションで meta に書く値（キー → 値）。前回同期した日時など
 * @param expected 最新化開始時の端末データ。指定時は変更・未送信削除がない場合だけ置換する。
 * @returns 置換が完了した場合はtrue、端末側に変更があれば何も書かずfalse。
 */
export async function replaceStudentData(
  studentId: string,
  data: Record<SyncedStore, unknown[]>,
  meta: Record<string, unknown> = {},
  expected?: PushSnapshot
): Promise<boolean> {
  const stores = Object.keys(data) as SyncedStore[];

  const db = await openDb();

  const tx = db.transaction(
    [...stores, "materials", "meta", ...(expected ? ["deletions"] : [])],
    "readwrite"
  );

  let applied = false;
  const apply = () => {
    for (const store of stores) {
      const os = tx.objectStore(store);

      const req = os.index("studentId")
        .getAllKeys(studentId);

      req.onsuccess = () => {
        if (store === "learningItems") {
          // 親の学習項目が消える前に、
          // 旧形式の資料へ所有者情報を補完する。
          const oldItemIds = new Set(req.result);

          const materials = tx.objectStore(
            "materials"
          );

          const materialReq = materials.getAll();

          materialReq.onsuccess = () => {
            for (
              const m of materialReq.result as Material[]
            ) {
              if (
                !m.studentId &&
                oldItemIds.has(m.itemId)
              ) {
                materials.put({
                  ...m,
                  studentId,
                });
              }
            }
          };
        }

        // その学生の同期データを入れ替える。
        for (const key of req.result) {
          os.delete(key);
        }

        for (const v of data[store]) {
          os.put(structuredClone(v));
        }
      };
    }

    const ms = tx.objectStore("meta");

    for (const [k, v] of Object.entries(meta)) {
      ms.put(v, k);
    }
    applied = true;
  };

  if (expected) {
    // 全照合を終えるまで書き込み要求を発行しない。
    // 比較と置換を同じreadwrite txに入れて、比較直後の編集との競合も防ぐ。
    let remaining = stores.length + 1;
    let matches = true;
    const checked = (ok: boolean) => {
      matches = matches && ok;
      if (--remaining === 0 && matches) apply();
    };
    for (const store of stores) {
      const before = expected[store].filter(row => row.studentId === studentId);
      const req = tx.objectStore(store).index("studentId").getAll(studentId);
      req.onsuccess = () => checked(sameStoredValue(before, req.result));
    }
    const pending = tx.objectStore("deletions").index("studentId").count(studentId);
    pending.onsuccess = () => checked(pending.result === 0);
  } else {
    apply();
  }

  await done(tx);
  return applied;
}

/** Neon にまだ伝えていない削除を記録する（SyncManager.pushChanges で送る） */
export interface Deletion { table: string; key: string; studentId: string; at: string; revision?: string }

// 同一ミリ秒の再登録でも別の削除ログとして区別する。旧ログのrevision欠落は許容する。
function deletionRevision(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),
    b => b.toString(16).padStart(2, "0")).join("");
}

/** SYNC-07d-1: 単独のテスト・前提リンクの削除と削除ログ登録を同じtxで行う。 */
export function deleteSyncedLeaf(storeName: "tests", key: string): Promise<void>;
export function deleteSyncedLeaf(storeName: "prerequisites", key: [string, string]): Promise<void>;
export async function deleteSyncedLeaf(
  storeName: "tests" | "prerequisites", key: string | [string, string]
): Promise<void> {
  const ids = typeof key === "string" ? [key] : key;
  if ((storeName === "tests" ? typeof key !== "string" : !Array.isArray(key) || key.length !== 2) ||
      !ids.every(id => typeof id === "string" && id.length > 0 && !/[^A-Za-z0-9_-]/.test(id))) {
    throw new Error("削除対象のキーが不正です");
  }
  const table = storeName === "tests" ? "test" : "prerequisite";
  const logKey = ids.join("|");
  const db = await openDb();
  const tx = db.transaction([storeName, "deletions"], "readwrite");
  const store = tx.objectStore(storeName);
  const logs = tx.objectStore("deletions");
  let failure: unknown;
  // リクエストエラー時もabortの完了まで待ち、ロールバック後に失敗を返す。
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("削除の保存に失敗しました"));
  });
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const rowReq = store.get(key);
  rowReq.onsuccess = () => {
    const row = rowReq.result as { studentId?: string } | undefined;
    if (!row) return; // 存在しなければ従来どおり何も変更しない。
    if (typeof row.studentId !== "string" || !row.studentId.trim()) {
      abort(new Error("削除対象の所有者を確認できません"));
      return;
    }
    const owner = row.studentId;
    const logReq = logs.get([table, logKey]);
    logReq.onsuccess = () => {
      try {
        const previous = logReq.result as Deletion | undefined;
        if (previous && previous.studentId !== owner) {
          throw new Error("削除ログの所有者が一致しません");
        }
        const log: Deletion = { table, key: logKey, studentId: owner,
          at: new Date().toISOString(), revision: deletionRevision() };
        store.delete(key);
        logs.put(log);
      } catch (error) { abort(error); }
    };
  };
  await committed;
}

/** SYNC-07d-2a: 学習項目と関連行・資料本体・削除ログをまとめて削除する。 */
export async function deleteLearningItemTree(itemId: string): Promise<void> {
  if (typeof itemId !== "string" || !itemId || /[^A-Za-z0-9_-]/.test(itemId)) {
    throw new Error("削除対象のキーが不正です");
  }
  const db = await openDb();
  const stores: StoreName[] = ["subjects", "learningItems", "prerequisites", "notes", "tests", "materials", "materialContents", "deletions"];
  const tx = db.transaction(stores, "readwrite");
  const os = (name: StoreName) => tx.objectStore(name);
  let failure: unknown;
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("学習項目の削除に失敗しました"));
  });
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const rootReq = os("learningItems").get(itemId);
  rootReq.onsuccess = () => {
    try {
      const root = rootReq.result as LearningItem | undefined;
      // 親がない場合は所属が確認できない孤立データを消さない。
      if (!root) return;
      const owner = root.studentId;
      if (typeof owner !== "string" || !owner.trim()) throw new Error("削除対象の所有者を確認できません");
      const parentReq = os("subjects").get(root.subjectId);
      const itemsReq = os("learningItems").getAll();
      const linksReq = os("prerequisites").getAll();
      const notesReq = os("notes").index("itemId").getAll(itemId);
      const testsReq = os("tests").index("itemId").getAll(itemId);
      const materialsReq = os("materials").index("itemId").getAll(itemId);
      const logReq = os("deletions").get(["learning_item", itemId]);
      const reads = [parentReq, itemsReq, linksReq, notesReq, testsReq, materialsReq, logReq];
      let remaining = reads.length;
      const checked = () => {
        if (--remaining !== 0) return;
        try {
          const requireOwner = (row: { studentId: string } | undefined, relation: string) => {
            if (!row || row.studentId !== owner) throw new Error("削除対象の所有者が一致しません（" + relation + "）");
          };
          requireOwner(parentReq.result as Subject | undefined, "subject");
          const items = new Map((itemsReq.result as LearningItem[]).map(i => [i.itemId, i]));
          const links = (linksReq.result as Prerequisite[]).filter(p => p.itemId === itemId || p.prereqItemId === itemId);
          const notes = notesReq.result as Note[];
          const tests = testsReq.result as Test[];
          const materials = materialsReq.result as Material[];
          const previous = logReq.result as Deletion | undefined;
          if (previous) requireOwner(previous, "deletions");
          for (const p of links) {
            requireOwner(p, "prerequisite");
            for (const id of [p.itemId, p.prereqItemId]) {
              const peer = items.get(id);
              requireOwner(peer, "prerequisite → learning_item");
              if (peer?.subjectId !== root.subjectId) throw new Error("削除対象の所属科目が一致しません（prerequisite）");
            }
          }
          const requireParent = (actual: string, expected: string, relation: string) => {
            if (!expected || actual !== expected) throw new Error("削除対象の参照先が一致しません（" + relation + "）");
          };
          for (const n of notes) {
            requireOwner(n, "note");
            for (const p of n.parts) {
              requireOwner(p, "note_part"); requireParent(p.noteId, n.noteId, "note_part → note");
              for (const w of p.words) {
                requireOwner(w, "word"); requireParent(w.partId, p.partId, "word → note_part");
              }
            }
          }
          for (const t of tests) {
            requireOwner(t, "test");
            const questions = new Set(t.questions.map(q => q.questionId));
            for (const q of t.questions) {
              requireOwner(q, "question"); requireParent(q.testId, t.testId, "question → test");
            }
            for (const a of t.attempts) {
              requireOwner(a, "attempt"); requireParent(a.testId, t.testId, "attempt → test");
              for (const x of a.answers) {
                requireOwner(x, "answer"); requireParent(x.attemptId, a.attemptId, "answer → attempt");
                if (!x.questionId || !questions.has(x.questionId)) throw new Error("削除対象の参照先が一致しません（answer → question）");
              }
            }
          }
          for (const m of materials) {
            // 所有者欄がない旧形式は、同じtxで確認済みの親からのみ判断する。
            if (m.studentId !== undefined && m.studentId !== "") requireOwner(m, "material");
          }
          // 検証がすべて成功するまで削除・書込リクエストを発行しない。
          const log: Deletion = { table: "learning_item", key: itemId, studentId: owner,
            at: new Date().toISOString(), revision: deletionRevision() };
          for (const p of links) os("prerequisites").delete([p.itemId, p.prereqItemId]);
          for (const n of notes) os("notes").delete(n.noteId);
          for (const t of tests) os("tests").delete(t.testId);
          for (const m of materials) {
            os("materials").delete(m.materialId);
            os("materialContents").delete(m.materialId);
          }
          os("learningItems").delete(itemId);
          // クラウドの子孫は既存のCASCADEに任せる。既存の別ログは消さない。
          os("deletions").put(log);
        } catch (error) { abort(error); }
      };
      for (const req of reads) req.onsuccess = checked;
    } catch (error) { abort(error); }
  };
  await committed;
}

/** SYNC-07a: 送信した版と現在の版が一致する場合だけ削除ログを消費する。 */
export async function acknowledgeDeletion(sent: Deletion): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction("deletions", "readwrite");
  const store = tx.objectStore("deletions");
  const key = [sent.table, sent.key];
  let matched = false;
  const req = store.get(key);
  req.onsuccess = () => {
    const current = req.result as Deletion | undefined;
    if (current && current.table === sent.table && current.key === sent.key &&
        current.studentId === sent.studentId && current.at === sent.at &&
        current.revision === sent.revision) {
      store.delete(key);
      matched = true;
    }
  };
  // 読み取りと削除を同じトランザクションで行い、コミット後に返す。
  await done(tx);
  return matched;
}
export async function recordDeletion(table: string, key: string, studentId: string): Promise<void> {
  if (!studentId) return; // 学生IDがない（ログイン前など）ときは同期しない
  await put("deletions", { table, key, studentId, at: new Date().toISOString(), revision: deletionRevision() } satisfies Deletion);
}

/** 前提関係の変更計画を作る関数 */
export type PrerequisiteEdit = (
  items: LearningItem[],
  links: Prerequisite[]
) => {
  studentId: string;
  add: Link[];
  remove: Link[];
};

/**
 * 前提関係の検証・追加・削除・削除記録を
 * 同一トランザクションで処理する。
 */
export async function editPrerequisites(
  plan: PrerequisiteEdit
): Promise<void> {
  const db = await openDb();

  const tx = db.transaction(
    ["learningItems", "prerequisites", "deletions"],
    "readwrite"
  );

  const items = tx.objectStore("learningItems");
  const links = tx.objectStore("prerequisites");
  const deletions = tx.objectStore("deletions");

  let failure: unknown;

  const itemReq = items.getAll();

  itemReq.onsuccess = () => {
    const linkReq = links.getAll();

    linkReq.onsuccess = () => {
      try {
        const changes = plan(
          itemReq.result as LearningItem[],
          linkReq.result as Prerequisite[]
        );

        const t = new Date().toISOString();

        for (const l of changes.remove) {
          links.delete([
            l.itemId,
            l.prereqItemId,
          ]);

          deletions.put({
            table: "prerequisite",
            key: `${l.itemId}|${l.prereqItemId}`,
            studentId: changes.studentId,
            at: t,
            revision: deletionRevision(),
          } satisfies Deletion);
        }

        for (const l of changes.add) {
          links.put({
            itemId: l.itemId,
            prereqItemId: l.prereqItemId,
            studentId: changes.studentId,
            updatedAt: t,
          } satisfies Prerequisite);
        }
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
  };

  try {
    await done(tx);
  } catch (e) {
    throw failure ?? e ?? new Error(
      "前提関係の保存に失敗しました"
    );
  }
}
/**
 * テストの読み込みと更新を
 * 同一トランザクションで行う。
 */
export async function editStoredTest<T>(
  testId: string,
  edit: (row: Test) => {
    test: Test;
    result: T;
  }
): Promise<T> {
  const db = await openDb();

  const tx = db.transaction(
    "tests",
    "readwrite"
  );

  const store = tx.objectStore("tests");

  let failure: unknown;
  let result!: T;

  const req = store.get(testId);

  req.onsuccess = () => {
    try {
      const row = req.result as Test | undefined;

      if (!row) {
        throw new Error("テストが見つかりません");
      }

      const updated = edit(row);

      store.put(structuredClone(updated.test));

      result = updated.result;
    } catch (e) {
      failure = e;
      tx.abort();
    }
  };

  try {
    await done(tx);
  } catch (e) {
    throw failure ?? e ?? new Error(
      "テストの保存に失敗しました"
    );
  }

  return result;
}
