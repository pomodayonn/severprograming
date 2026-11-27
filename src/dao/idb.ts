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

/**
 * その学生の同期データを、受け取った内容にまるごと入れ替える（11/23）。
 * 「古い分を消す」「新しい分を入れる」「同期した時刻を書く」を1つのトランザクションでするので、
 * 途中でタブを閉じたりエラーになったりしても、全部入れ替わるか、何も変わらないかのどちらかになる
 * （Java の JDBC で setAutoCommit(false) → 最後に commit、失敗したら rollback するのと同じ考え方）
 * @param meta 同じトランザクションで meta に書く値（キー → 値）。前回同期した日時など
 */
export async function replaceStudentData(
  studentId: string,
  data: Record<SyncedStore, unknown[]>,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const stores = Object.keys(data) as SyncedStore[];

  const db = await openDb();

  const tx = db.transaction(
    [...stores, "materials", "meta"],
    "readwrite"
  );

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

  await done(tx);
}

/** Neon にまだ伝えていない削除を記録する（SyncManager.pushChanges で送る） */
export interface Deletion { table: string; key: string; studentId: string; at: string }
export async function recordDeletion(table: string, key: string, studentId: string): Promise<void> {
  if (!studentId) return; // 学生IDがない（ログイン前など）ときは同期しない
  await put("deletions", { table, key, studentId, at: new Date().toISOString() } satisfies Deletion);
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
