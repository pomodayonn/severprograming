// DB-06a：関連図保存処理の原子性

import "fake-indexeddb/auto";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  openDb,
  put,
  getAll,
} from "../../src/dao/idb";

import { LearningItemDAO } from "../../src/dao/LearningItemDAO";
import { PrerequisiteDAO } from "../../src/dao/PrerequisiteDAO";
import { NoteDAO } from "../../src/dao/NoteDAO";
import { TestDAO } from "../../src/dao/TestDAO";
import { MaterialDAO } from "../../src/dao/MaterialDAO";

import { LearningItem } from "../../src/beans/LearningItem";
import { Prerequisite } from "../../src/beans/Prerequisite";
import {
  LearningItemManager,
} from "../../src/managers/LearningItemManager";

import { hasCycle } from "../../src/lib/logic";

const studentId = "student-a";

const sync = {
  pushChanges: vi.fn().mockResolvedValue(undefined),
};

const manager = new LearningItemManager(
  new LearningItemDAO(),
  new PrerequisiteDAO(),
  new NoteDAO(),
  new TestDAO(),
  new MaterialDAO(),
  sync
);

const links = () =>
  getAll<Prerequisite>("prerequisites");

async function seedLink(
  itemId: string,
  prereqItemId: string
) {
  await put(
    "prerequisites",
    new Prerequisite({
      itemId,
      prereqItemId,
      studentId,
    })
  );
}

beforeEach(async () => {
  sync.pushChanges.mockClear();

  const db = await openDb();
  const stores = Array.from(db.objectStoreNames);

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    for (const store of stores) {
      tx.objectStore(store).clear();
    }
  });

  for (const itemId of ["a", "b", "c", "d"]) {
    await put(
      "learningItems",
      new LearningItem({
        itemId,
        studentId,
        subjectId: "subject-a",
      })
    );
  }

  // 別のアカウントの項目
  await put(
    "learningItems",
    new LearningItem({
      itemId: "other",
      studentId: "student-b",
      subjectId: "subject-b",
    })
  );
});

describe("DB-06a：関連図のトランザクション", () => {
  it("前提関係の追加・削除と削除記録を保存する", async () => {
    await seedLink("b", "a");
    await seedLink("d", "c");

    await manager.setPrerequisites(
      "b",
      ["c"]
    );

    expect(await links()).toEqual([
      expect.objectContaining({
        itemId: "b",
        prereqItemId: "c",
      }),
      expect.objectContaining({
        itemId: "d",
        prereqItemId: "c",
      }),
    ]);

    expect(await getAll("deletions")).toEqual([
      expect.objectContaining({
        table: "prerequisite",
        key: "b|a",
        studentId,
      }),
    ]);

    expect(sync.pushChanges)
      .toHaveBeenCalledOnce();
  });

  it("循環する変更を保存しない", async () => {
    await seedLink("b", "a");

    const before = await links();

    await expect(
      manager.setPrerequisites("a", ["b"])
    ).rejects.toThrow("輪になる");

    expect(await links()).toEqual(before);
    expect(await getAll("deletions")).toEqual([]);
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });

  it("別アカウントの項目との関連付けを拒否する", async () => {
    await expect(
      manager.setPrerequisites("a", ["other"])
    ).rejects.toThrow("同じ科目");

    expect(await links()).toEqual([]);
    expect(await getAll("deletions")).toEqual([]);
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });

  it("並行保存でも循環する関係を作らない", async () => {
    const results = await Promise.allSettled([
      manager.setPrerequisites("a", ["b"]),
      manager.setPrerequisites("b", ["a"]),
    ]);

    expect(
      results.filter(r => r.status === "fulfilled")
    ).toHaveLength(1);

    expect(
      results.filter(r => r.status === "rejected")
    ).toHaveLength(1);

    const saved = await links();

    expect(saved).toHaveLength(1);
    expect(hasCycle(saved)).toBe(false);

    expect(sync.pushChanges)
      .toHaveBeenCalledOnce();
  });

  it("保存途中の中断で関連図と削除記録を元に戻す", async () => {
    await seedLink("b", "a");

    const before = await links();

    const originalPut = IDBObjectStore.prototype.put;

    const spy = vi.spyOn(
      IDBObjectStore.prototype,
      "put"
    ).mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const req = originalPut.call(
        this, value, key
      );

      if (this.name === "prerequisites") {
        req.addEventListener(
          "success",
          () => this.transaction.abort(),
          { once: true }
        );
      }

      return req;
    });

    try {
      await expect(
        manager.setPrerequisites("b", ["c"])
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }

    expect(await links()).toEqual(before);
    expect(await getAll("deletions")).toEqual([]);
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });
});