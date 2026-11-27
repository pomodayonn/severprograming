// SYNC-09：端末内資料の所有者管理とデータ保護
// 実際のDAOとIndexedDB共通処理を検証する。
// 本物のブラウザやNeonのデータには接続しない。

import "fake-indexeddb/auto";

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  openDb,
  get,
  put,
  del,
  clearStudentData,
  replaceStudentData,
} from "../../src/dao/idb";

import {
  MaterialDAO,
} from "../../src/dao/MaterialDAO";

import {
  Material,
} from "../../src/beans/Material";

import {
  LearningItem,
} from "../../src/beans/LearningItem";

const studentA = "student-a";
const studentB = "student-b";

const itemA = "item-a";
const itemB = "item-b";

const dao = new MaterialDAO();

beforeEach(async () => {
  const db = await openDb();

  const stores = Array.from(db.objectStoreNames);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    for (const name of stores) {
      tx.objectStore(name).clear();
    }
  });

  await put(
    "learningItems",
    new LearningItem({
      itemId: itemA,
      studentId: studentA,
    })
  );

  await put(
    "learningItems",
    new LearningItem({
      itemId: itemB,
      studentId: studentB,
    })
  );
});

function material(
  materialId: string,
  itemId: string
): Material {
  return new Material({
    materialId,
    itemId,
    fileName: `${materialId}.txt`,
    fileType: "text",
  });
}

async function legacy(
  materialId: string,
  itemId: string
) {
  // 学生IDを持たない旧形式の資料。
  await put("materials", {
    materialId,
    itemId,
    fileName: `${materialId}.txt`,
    fileType: "text",
  });

  await put(
    "materialContents",
    "旧形式の資料",
    materialId
  );
}

const emptySyncData = () => ({
  subjects: [],
  learningItems: [],
  prerequisites: [],
  notes: [],
  tests: [],
});

describe("SYNC-09：資料の所有者管理", () => {
  it("資料保存時に学習項目から所有者を取得する", async () => {
    await dao.insert(
      material("material-a", itemA),
      "学習資料A"
    );

    const saved = await dao.findById(
      "material-a"
    );

    expect(saved?.studentId).toBe(studentA);

    expect(
      await dao.findContent("material-a")
    ).toBe("学習資料A");
  });

  it("親の学習項目が存在しない資料は保存しない", async () => {
    await expect(
      dao.insert(
        material("invalid", "missing-item"),
        "保存してはいけない資料"
      )
    ).rejects.toThrow(
      "学習項目または所有者が見つかりません"
    );

    expect(
      await dao.findById("invalid")
    ).toBeNull();

    expect(
      await dao.findContent("invalid")
    ).toBeNull();
  });

  it("最新化時に旧形式の資料の所有者を補完する", async () => {
    await legacy("legacy-a", itemA);
    await legacy("legacy-b", itemB);

    await replaceStudentData(
      studentA,
      emptySyncData()
    );

    expect(
      await get("learningItems", itemA)
    ).toBeUndefined();

    expect(
      await get("learningItems", itemB)
    ).toBeDefined();

    expect(
      (await dao.findById("legacy-a"))?.studentId
    ).toBe(studentA);

    expect(
      await dao.findContent("legacy-a")
    ).toBe("旧形式の資料");

    expect(
      (await dao.findById("legacy-b"))?.studentId
    ).toBe("");
  });

  it("端末データ削除時に所有者が判明している孤立資料を消す", async () => {
    await legacy("legacy-a", itemA);

    await dao.insert(
      material("material-a", itemA),
      "資料A"
    );

    await dao.insert(
      material("material-b", itemB),
      "資料B"
    );

    // 既に親を失っており、所有者不明の旧資料。
    await legacy(
      "unknown",
      "missing-item"
    );

    // 別端末で学習項目Aが削除された状態を再現。
    await replaceStudentData(
      studentA,
      emptySyncData()
    );

    await clearStudentData(studentA);

    for (
      const id of ["legacy-a", "material-a"]
    ) {
      expect(
        await dao.findById(id)
      ).toBeNull();

      expect(
        await dao.findContent(id)
      ).toBeNull();
    }

    // 他人の資料を消さない。
    expect(
      await dao.findById("material-b")
    ).not.toBeNull();

    expect(
      await dao.findContent("material-b")
    ).toBe("資料B");

    // 所有者が不明な旧資料を勝手に消さない。
    expect(
      await dao.findById("unknown")
    ).not.toBeNull();

    expect(
      await dao.findContent("unknown")
    ).toBe("旧形式の資料");
  });

  it("資料の削除時にファイル本体も削除する", async () => {
    await dao.insert(
      material("material-a", itemA),
      "資料A"
    );

    await dao.delete("material-a");

    expect(
      await dao.findById("material-a")
    ).toBeNull();

    expect(
      await dao.findContent("material-a")
    ).toBeNull();
  });
  describe("IndexedDB共通処理の回帰テスト", () => {
  it("共通のdel関数で指定したデータだけを削除する", async () => {
    await put("meta", "value-a", "key-a");
    await put("meta", "value-b", "key-b");

    await del("meta", "key-a");

    expect(
      await get("meta", "key-a")
    ).toBeUndefined();

    expect(
      await get("meta", "key-b")
    ).toBe("value-b");
  });

  it("旧形式の資料も所有者を確認して端末データを削除する", async () => {
    await legacy("legacy-a", itemA);
    await legacy("legacy-b", itemB);

    await put(
      "meta",
      "sync-a",
      `lastSyncedAt:${studentA}`
    );

    await put(
      "meta",
      "sync-b",
      `lastSyncedAt:${studentB}`
    );

    await clearStudentData(studentA);

    expect(
      await dao.findById("legacy-a")
    ).toBeNull();

    expect(
      await dao.findContent("legacy-a")
    ).toBeNull();

    expect(
      await get("learningItems", itemA)
    ).toBeUndefined();

    expect(
      await get("meta", `lastSyncedAt:${studentA}`)
    ).toBeUndefined();

    // 別アカウントのデータは保持する。
    expect(
      await dao.findById("legacy-b")
    ).not.toBeNull();

    expect(
      await dao.findContent("legacy-b")
    ).toBe("旧形式の資料");

    expect(
      await get("learningItems", itemB)
    ).toBeDefined();

    expect(
      await get("meta", `lastSyncedAt:${studentB}`)
    ).toBe("sync-b");
  });
});
});