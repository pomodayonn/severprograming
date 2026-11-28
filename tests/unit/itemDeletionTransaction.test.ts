// SYNC-07d-2a: fake-indexeddbの合成データのみ。Neon/実ブラウザには接続しない。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, get, getAll, put, type Deletion, type StoreName } from "../../src/dao/idb";
import { LearningItemDAO } from "../../src/dao/LearningItemDAO";
import { PrerequisiteDAO } from "../../src/dao/PrerequisiteDAO";
import { NoteDAO } from "../../src/dao/NoteDAO";
import { TestDAO } from "../../src/dao/TestDAO";
import { MaterialDAO } from "../../src/dao/MaterialDAO";
import { LearningItemManager } from "../../src/managers/LearningItemManager";
import { Subject } from "../../src/beans/Subject";
import { LearningItem } from "../../src/beans/LearningItem";
import { Prerequisite } from "../../src/beans/Prerequisite";
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Word } from "../../src/beans/Word";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { Attempt } from "../../src/beans/Attempt";
import { Answer } from "../../src/beans/Answer";
import { Material } from "../../src/beans/Material";

const sid = "student-a", other = "student-b";
const at = "2026-11-25T00:00:00.000Z";
const root = new LearningItem({ itemId: "i1", studentId: sid, subjectId: "s1" });
const peer = new LearningItem({ itemId: "i2", studentId: sid, subjectId: "s1" });
const note = new Note({ noteId: "n1", itemId: "i1", studentId: sid, parts: [new NotePart({ partId: "p1", noteId: "n1", studentId: sid, words: [new Word({ wordId: "w1", partId: "p1", studentId: sid })] })] });
const test = new Test({ testId: "t1", itemId: "i1", studentId: sid, questionCount: 1, questions: [new Question({ questionId: "q1", testId: "t1", studentId: sid, number: 1 })], attempts: [new Attempt({ attemptId: "a1", testId: "t1", studentId: sid, attemptNo: 1, answers: [new Answer({ answerId: "x1", attemptId: "a1", questionId: "q1", studentId: sid })] })] });
const link = new Prerequisite({ itemId: "i2", prereqItemId: "i1", studentId: sid });
const material = new Material({ materialId: "m1", itemId: "i1", studentId: sid, fileType: "text" });
const oldLog: Deletion = { table: "learning_item", key: "i1", studentId: sid, at, revision: "a".repeat(32) };
const unrelatedLog: Deletion = { table: "test", key: "other-test", studentId: other, at };
const stores: StoreName[] = ["subjects", "learningItems", "prerequisites", "notes", "tests", "materials", "materialContents", "deletions", "meta"];
const sync = { pushChanges: vi.fn<() => Promise<void>>() };
const manager = new LearningItemManager(new LearningItemDAO(), new PrerequisiteDAO(), new NoteDAO(), new TestDAO(), new MaterialDAO(), sync);
const snapshot = () => Promise.all(stores.map(s => getAll(s)));
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("aborted"));
});

beforeEach(async () => {
  sync.pushChanges.mockReset().mockResolvedValue(undefined);
  const db = await openDb();
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  for (const s of stores) tx.objectStore(s).clear();
  await done;
  await put("subjects", new Subject({ subjectId: "s1", studentId: sid }));
  await put("subjects", new Subject({ subjectId: "s2", studentId: other }));
  await put("learningItems", root);
  await put("learningItems", peer);
  await put("learningItems", new LearningItem({ itemId: "i4", subjectId: "s1", studentId: sid }));
  await put("learningItems", new LearningItem({ itemId: "i3", subjectId: "s2", studentId: other }));
  await put("prerequisites", link);
  await put("prerequisites", new Prerequisite({ itemId: "i1", prereqItemId: "i4", studentId: sid }));
  await put("notes", note);
  await put("notes", new Note({ noteId: "n2", itemId: "i2", studentId: sid }));
  await put("tests", test);
  await put("tests", new Test({ testId: "t2", itemId: "i1", studentId: sid }));
  await put("tests", new Test({ testId: "t3", itemId: "i3", studentId: other }));
  await put("materials", material);
  await put("materialContents", "消す資料の合成データ", "m1");
  await put("materials", new Material({ materialId: "m2", itemId: "i3", studentId: other }));
  await put("materialContents", "保持する資料", "m2");
  await put("deletions", unrelatedLog);
  await put("meta", "old", "lastPulledAt:" + sid);
});

async function rejectUnchanged(message?: string) {
  const before = await snapshot();
  await expect(manager.deleteItem("i1")).rejects.toThrow(message);
  expect(await snapshot()).toEqual(before);
  expect(sync.pushChanges).not.toHaveBeenCalled();
}

describe("SYNC-07d-2a：学習項目の一括削除", () => {
  it("関連行と資料本体と削除ログを同じtxで反映し、コミット後に同期する", async () => {
    const db = await openDb();
    // spyを設定する前に元の関数を保持し、spy自身の再呼出を避ける。
    const original = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction");
    // 同期呼び出し時点で削除txが完了していることも確認。
    let committedAtSync = false;
    let observedAtSync = false;
    spy.mockImplementationOnce((...args) => {
      const tx = original(...args);
      tx.addEventListener("complete", () => { committedAtSync = true; });
      return tx;
    });
    sync.pushChanges.mockImplementation(async () => { observedAtSync = committedAtSync; });
    try {
      await manager.deleteItem("i1");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(stores.filter(s => s !== "meta"), "readwrite");
    } finally { spy.mockRestore(); }
    expect(committedAtSync).toBe(true);
    expect(observedAtSync).toBe(true);
    expect(await get("learningItems", "i1")).toBeUndefined();
    expect(await getAll("prerequisites")).toEqual([]);
    expect(await get("notes", "n1")).toBeUndefined();
    expect(await get("tests", "t1")).toBeUndefined();
    expect(await get("tests", "t2")).toBeUndefined();
    expect(await get("materials", "m1")).toBeUndefined();
    expect(await get("materialContents", "m1")).toBeUndefined();
    expect(await get("learningItems", "i2")).toEqual(peer);
    expect(await get("learningItems", "i3")).toBeDefined();
    expect(await get("subjects", "s1")).toBeDefined();
    expect(await get("notes", "n2")).toBeDefined();
    expect(await get("tests", "t3")).toBeDefined();
    expect(await get("materials", "m2")).toBeDefined();
    expect(await get("materialContents", "m2")).toBe("保持する資料");
    expect(await getAll("deletions")).toEqual([
      expect.objectContaining({ table: "learning_item", key: "i1", studentId: sid, revision: expect.stringMatching(/^[a-f0-9]{32}$/) }), unrelatedLog,
    ]);
    expect(await get("meta", "lastPulledAt:" + sid)).toBe("old");
    expect(sync.pushChanges).toHaveBeenCalledOnce();
  });
  it("親を確認できる旧資料も対象に含める", async () => {
    await put("materials", { materialId: "legacy", itemId: "i1" });
    await put("materialContents", "旧資料", "legacy");
    await manager.deleteItem("i1");
    expect(await get("materials", "legacy")).toBeUndefined();
    expect(await get("materialContents", "legacy")).toBeUndefined();
  });
  it("存在しない親IDでは孤立した子を削除しない", async () => {
    await put("notes", new Note({ noteId: "orphan", itemId: "missing", studentId: sid }));
    const before = await snapshot();
    await manager.deleteItem("missing", false);
    expect(await snapshot()).toEqual(before);
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });
  it("不正な親IDを拒否する", async () => {
    await put("learningItems", { ...root, itemId: "i 1" });
    const before = await snapshot();
    await expect(manager.deleteItem("i 1")).rejects.toThrow("キーが不正");
    expect(await snapshot()).toEqual(before);
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });
  const invalid: [string, string, () => Promise<void>][] = [
    ["親の所有者欠落", "所有者を確認できません", () => put("learningItems", { ...root, studentId: "" })],
    ["科目の所有者不一致", "subject", () => put("subjects", new Subject({ subjectId: "s1", studentId: other }))],
    ["前提関係の所有者不一致", "prerequisite", () => put("prerequisites", { ...link, studentId: other })],
    ["前提関係の相手が別科目", "所属科目", () => put("learningItems", { ...peer, subjectId: "s2" })],
    ["ノートの所有者不一致", "note", () => put("notes", { ...note, studentId: other })],
    ["入れ子の単語の所有者不一致", "word", () => { const n = structuredClone(note); n.parts[0].words[0].studentId = other; return put("notes", n); }],
    ["テストの所有者不一致", "test", () => put("tests", { ...test, studentId: other })],
    ["入れ子の解答の参照不一致", "answer → question", () => { const t = structuredClone(test); t.attempts[0].answers[0].questionId = "missing"; return put("tests", t); }],
    ["資料の所有者不一致", "material", () => put("materials", { ...material, studentId: other })],
    ["既存ログの所有者不一致", "deletions", () => put("deletions", { ...oldLog, studentId: other })],
  ];
  it.each(invalid)("%sなら一切変更しない", async (_name, message, mutate) => {
    await mutate();
    await rejectUnchanged(message);
  });
  it("ログ書込後のabortで全行と資料本体を巻き戻す", async () => {
    await put("deletions", oldLog);
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const req = original.call(this, value, key);
      if (this.name === "deletions") req.addEventListener("success", () => this.transaction.abort(), { once: true });
      return req;
    });
    try { await rejectUnchanged(); } finally { spy.mockRestore(); }
    expect(await get("deletions", ["learning_item", "i1"])).toEqual(oldLog);
    expect(await get("materialContents", "m1")).toBe("消す資料の合成データ");
  });
  it("同じ所有者の既存ログを新版にして、sync=falseでは同期を呼ばない", async () => {
    await put("deletions", oldLog);
    await manager.deleteItem("i1", false);
    const saved = await get<Deletion>("deletions", ["learning_item", "i1"]);
    expect(saved).toMatchObject({ table: "learning_item", key: "i1", studentId: sid, revision: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(saved?.revision).not.toBe(oldLog.revision);
    expect(await get("learningItems", "i1")).toBeUndefined();
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });
});
