// SYNC-07b: fake-indexeddbだけを使う。実ブラウザやNeonに接続しない。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, put, getAll, readPushSnapshot, type Deletion } from "../../src/dao/idb";
import { Subject } from "../../src/beans/Subject";
import { LearningItem } from "../../src/beans/LearningItem";
import { Prerequisite } from "../../src/beans/Prerequisite";
import { Note } from "../../src/beans/Note";
import { Test } from "../../src/beans/Test";

const sid = "student-a";
const at = "2026-11-25T00:00:00.000Z";
const stores = ["subjects", "learningItems", "prerequisites", "notes", "tests", "deletions"];
const oldTest = new Test({ testId: "t1", itemId: "i1", studentId: sid, updatedAt: at });
const log: Deletion = { table: "test", key: "t1", studentId: sid, at, revision: "a".repeat(32) };

const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  tx.onerror = () => reject(tx.error ?? new Error("failed"));
});

// テストデータを消すのはfake-indexeddb内だけ。
beforeEach(async () => {
  const db = await openDb();
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  for (const name of stores) tx.objectStore(name).clear();
  await done;
});

// 削除と削除ログを同時に書く競合を合成する。
function queueDelete(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(["tests", "deletions"], "readwrite");
  const done = completed(tx);
  tx.objectStore("tests").delete(oldTest.testId);
  tx.objectStore("deletions").put(log);
  return done;
}

describe("SYNC-07b：送信スナップショットの一貫性", () => {
  it("6ストアを1つのreadonlyトランザクションで取得する", async () => {
    await put("subjects", new Subject({ subjectId: "s1", studentId: sid }));
    await put("subjects", new Subject({ subjectId: "s2", studentId: "student-b" }));
    await put("learningItems", new LearningItem({ itemId: "i1", subjectId: "s1", studentId: sid }));
    await put("learningItems", new LearningItem({ itemId: "i2", subjectId: "s1", studentId: sid }));
    await put("prerequisites", new Prerequisite({ itemId: "i1", prereqItemId: "i2", studentId: sid }));
    await put("notes", new Note({ noteId: "n1", itemId: "i1", studentId: sid }));
    await put("tests", oldTest);
    await put("deletions", { ...log, key: "old" });
    await put("deletions", { ...log, key: "other", studentId: "student-b" });
    const db = await openDb();
    const spy = vi.spyOn(db, "transaction");
    try {
      const snapshot = await readPushSnapshot(sid);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(stores, "readonly");
      // ルートの所有者フィルタと変更分抽出はSyncManagerに残す。
      expect(snapshot.subjects.map(x => x.subjectId)).toEqual(["s1", "s2"]);
      expect(snapshot.learningItems.map(x => x.itemId)).toEqual(["i1", "i2"]);
      expect(snapshot.prerequisites).toEqual([expect.objectContaining({ itemId: "i1", prereqItemId: "i2" })]);
      expect(snapshot.notes).toEqual([expect.objectContaining({ noteId: "n1", itemId: "i1" })]);
      expect(snapshot.tests).toEqual([expect.objectContaining({ testId: "t1" })]);
      expect(snapshot.deletions).toEqual([{ ...log, key: "old" }]);
    } finally { spy.mockRestore(); }
    expect(await getAll("deletions")).toHaveLength(2);
    expect(await getAll("tests")).toHaveLength(1);
  });

  it("先に開始した読取には後続の削除トランザクションが混入しない", async () => {
    await put("tests", oldTest);
    const db = await openDb();
    const reading = readPushSnapshot(sid);
    // readPushSnapshotのopenDb待ちを進めてreadonly txを開始させる。
    await Promise.resolve();
    const writing = queueDelete(db);
    const [before] = await Promise.all([reading, writing]);
    expect(before.tests.map(x => x.testId)).toEqual(["t1"]);
    expect(before.deletions).toEqual([]);
    const after = await readPushSnapshot(sid);
    expect(after.tests).toEqual([]);
    expect(after.deletions).toEqual([log]);
    // 取得済みのオブジェクトも後続書込みで変化しない。
    expect(before.tests.map(x => x.testId)).toEqual(["t1"]);
  });

  it("先に開始した削除トランザクションの完了後の状態を取得する", async () => {
    await put("tests", oldTest);
    const db = await openDb();
    const writing = queueDelete(db);
    const [snapshot] = await Promise.all([readPushSnapshot(sid), writing]);
    expect(snapshot.tests).toEqual([]);
    expect(snapshot.deletions).toEqual([log]);
  });

  it("読取トランザクションが中断したらスナップショットを返さない", async () => {
    await put("tests", oldTest);
    const db = await openDb();
    const original = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((...args) => {
      const tx = original(...args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    try {
      await expect(readPushSnapshot(sid)).rejects.toBeDefined();
    } finally { spy.mockRestore(); }
    expect(await getAll("tests")).toHaveLength(1);
    expect(await getAll("deletions")).toEqual([]);
  });
});
