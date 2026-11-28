// SYNC-07d-1: fake-indexeddbのみを使用。実データには接続しない。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, get, put, readPushSnapshot, type Deletion } from "../../src/dao/idb";
import { TestDAO } from "../../src/dao/TestDAO";
import { PrerequisiteDAO } from "../../src/dao/PrerequisiteDAO";
import { Test } from "../../src/beans/Test";
import { Prerequisite } from "../../src/beans/Prerequisite";

const sid = "student-a";
const at = "2026-11-25T00:00:00.000Z";
const stores = ["tests", "prerequisites", "deletions"];
const cases = [
  { store: "tests", table: "test", key: "t1", logKey: "t1",
    row: new Test({ testId: "t1", studentId: sid, itemId: "i1", updatedAt: at }),
    remove: () => new TestDAO().delete("t1"),
    invalid: () => new TestDAO().delete("t 1") },
  { store: "prerequisites", table: "prerequisite", key: ["i1", "i2"], logKey: "i1|i2",
    row: new Prerequisite({ itemId: "i1", prereqItemId: "i2", studentId: sid, updatedAt: at }),
    remove: () => new PrerequisiteDAO().delete("i1", "i2"),
    invalid: () => new PrerequisiteDAO().delete("i1", "i|2") },
] as const;

beforeEach(async () => {
  const db = await openDb();
  const tx = db.transaction(stores, "readwrite");
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  });
  for (const store of stores) tx.objectStore(store).clear();
  await complete;
});

describe.each(cases)("SYNC-07d-1：$table の単独削除", c => {
  const key = () => typeof c.key === "string" ? c.key : [...c.key];
  const oldLog = (): Deletion => ({ table: c.table, key: c.logKey, studentId: sid, at, revision: "a".repeat(32) });
  const readLog = () => get<Deletion>("deletions", [c.table, c.logKey]);
  it.each([false, true])("既存ログ=%s：削除と新版ログを1つのreadwrite txで保存する", async hasOld => {
    await put(c.store, c.row);
    if (hasOld) await put("deletions", oldLog());
    const db = await openDb();
    const spy = vi.spyOn(db, "transaction");
    try {
      await c.remove();
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith([c.store, "deletions"], "readwrite");
    } finally { spy.mockRestore(); }
    expect(await get(c.store, key())).toBeUndefined();
    const log = await readLog();
    expect(log).toMatchObject({ table: c.table, key: c.logKey, studentId: sid, revision: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(log?.revision).not.toBe(oldLog().revision);
    expect(new Date(log!.at).toISOString()).toBe(log!.at);
  });
  it("削除とログ書込みの後でもtxが中断したら両方を戻す", async () => {
    await put(c.store, c.row);
    await put("deletions", oldLog());
    const before = await readPushSnapshot(sid);
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const req = original.call(this, value, key);
      if (this.name === "deletions") req.addEventListener("success", () => this.transaction.abort());
      return req;
    });
    try { await expect(c.remove()).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(await readPushSnapshot(sid)).toEqual(before);
    expect(await readLog()).toEqual(oldLog());
  });
  it("対象がなければ既存ログを変更しない", async () => {
    await put("deletions", oldLog());
    await c.remove();
    expect(await readLog()).toEqual(oldLog());
  });
  it("所有者不明の行を削除しない", async () => {
    const row = { ...c.row, studentId: "" };
    await put(c.store, row);
    await expect(c.remove()).rejects.toThrow("所有者を確認できません");
    expect(await get(c.store, key())).toEqual(row);
    expect(await readLog()).toBeUndefined();
  });
  it("別所有者の既存ログと衝突したら両方保持する", async () => {
    await put(c.store, c.row);
    const other = { ...oldLog(), studentId: "student-b" };
    await put("deletions", other);
    await expect(c.remove()).rejects.toThrow("所有者が一致しません");
    expect(await get(c.store, key())).toEqual(c.row);
    expect(await readLog()).toEqual(other);
  });
  it("同期に使えないキーは削除しない", async () => {
    const row = c.store === "tests" ? { ...c.row, testId: "t 1" } : { ...c.row, prereqItemId: "i|2" };
    const invalidKey = c.store === "tests" ? "t 1" : ["i1", "i|2"];
    await put(c.store, row);
    await expect(c.invalid()).rejects.toThrow("キーが不正です");
    expect(await get(c.store, invalidKey)).toEqual(row);
    expect((await readPushSnapshot(sid)).deletions).toEqual([]);
  });
});
