// SYNC-07d-2b: fake-indexeddbの合成データのみ。Neon/実ブラウザには接続しない。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, get, getAll, put, type Deletion, type StoreName } from "../../src/dao/idb";
import { SubjectDAO } from "../../src/dao/SubjectDAO";
import { SubjectManager } from "../../src/managers/SubjectManager";
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
const oldLog: Deletion = { table: "subject", key: "s1", studentId: sid, at, revision: "a".repeat(32) };
const unrelatedLog: Deletion = { table: "test", key: "other-test", studentId: other, at };
const stores: StoreName[] = ["subjects", "learningItems", "prerequisites", "notes", "tests", "materials", "materialContents", "deletions", "meta"];
const sync = { pushChanges: vi.fn<() => Promise<void>>() };
const itemManager = new LearningItemManager(new LearningItemDAO(), new PrerequisiteDAO(), new NoteDAO(), new TestDAO(), new MaterialDAO(), sync);
const manager = new SubjectManager(new SubjectDAO(), itemManager, sync);
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
  await put("subjects", new Subject({ subjectId: "s3", studentId: sid }));
  await put("learningItems", new LearningItem({ itemId: "i5", subjectId: "s3", studentId: sid }));
  await put("notes", new Note({ noteId: "n5", itemId: "i5", studentId: sid }));
  await put("materials", new Material({ materialId: "m5", itemId: "i5", studentId: sid }));
  await put("materialContents", "別科目の資料", "m5");
  await put("meta", "old", "lastPulledAt:" + sid);
});

async function rejectUnchanged(message?: string) {
  const before = await snapshot();
  await expect(manager.deleteSubject("s1")).rejects.toThrow(message);
  expect(await snapshot()).toEqual(before);
  expect(sync.pushChanges).not.toHaveBeenCalled();
}

describe("SYNC-07d-2b：科目全体の一括削除", () => {
  it("複数学習項目と科目を単一txで消し、コミット後に一度だけ同期する", async () => {
    const db = await openDb();
    const original = db.transaction.bind(db); // spy設定前に取得
    const spy = vi.spyOn(db, "transaction");
    let committed = false;
    let observedAtSync = false;
    spy.mockImplementation((...args) => {
      const tx = original(...args);
      tx.addEventListener("complete", () => { committed = true; });
      return tx;
    });
    sync.pushChanges.mockImplementation(async () => { observedAtSync = committed; });
    try {
      await manager.deleteSubject("s1");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(stores.filter(s => s !== "meta"), "readwrite");
    } finally { spy.mockRestore(); }
    expect(observedAtSync).toBe(true);
    expect(sync.pushChanges).toHaveBeenCalledOnce();
    expect((await getAll<Subject>("subjects")).map(s => s.subjectId)).toEqual(["s2", "s3"]);
    expect((await getAll<LearningItem>("learningItems")).map(i => i.itemId)).toEqual(["i3", "i5"]);
    expect(await getAll("prerequisites")).toEqual([]);
    expect((await getAll<Note>("notes")).map(n => n.noteId)).toEqual(["n5"]);
    expect((await getAll<Test>("tests")).map(t => t.testId)).toEqual(["t3"]);
    expect((await getAll<Material>("materials")).map(m => m.materialId)).toEqual(["m2", "m5"]);
    expect(await get("materialContents", "m1")).toBeUndefined();
    expect(await get("materialContents", "m2")).toBe("保持する資料");
    expect(await get("materialContents", "m5")).toBe("別科目の資料");
    const logs = await getAll<Deletion>("deletions");
    expect(logs).toEqual([
      ...["i1", "i2", "i4"].map(key => expect.objectContaining({ table: "learning_item", key, studentId: sid, revision: expect.stringMatching(/^[a-f0-9]{32}$/) })),
      expect.objectContaining({ table: "subject", key: "s1", studentId: sid, revision: expect.stringMatching(/^[a-f0-9]{32}$/) }),
      unrelatedLog,
    ]);
    expect(await get("meta", "lastPulledAt:" + sid)).toBe("old");
  });
  it("空の科目でも科目の削除ログを登録する", async () => {
    await put("subjects", new Subject({ subjectId: "empty", studentId: sid }));
    await manager.deleteSubject("empty");
    expect(await get("subjects", "empty")).toBeUndefined();
    expect(await get("deletions", ["subject", "empty"])).toMatchObject({ studentId: sid });
    expect(await get("learningItems", "i1")).toEqual(root);
  });
  it("科目が存在しなければ孤立した学習項目を消さない", async () => {
    await put("learningItems", new LearningItem({ itemId: "orphan", subjectId: "missing", studentId: sid }));
    const before = await snapshot();
    await new SubjectDAO().delete("missing");
    expect(await snapshot()).toEqual(before);
  });
  it("親から帰属が分かる旧資料と本体を同時に削除する", async () => {
    await put("materials", { materialId: "legacy", itemId: "i2" });
    await put("materialContents", "旧資料", "legacy");
    await manager.deleteSubject("s1");
    expect(await get("materials", "legacy")).toBeUndefined();
    expect(await get("materialContents", "legacy")).toBeUndefined();
  });
  const invalid: [string, string, () => Promise<void>][] = [
    ["科目の所有者欠落", "所有者を確認できません", () => put("subjects", new Subject({ subjectId: "s1" }))],
    ["後続学習項目の別所有者", "learning_item", () => put("learningItems", { ...peer, studentId: other })],
    ["学習項目の不正キー", "キーが不正", () => put("learningItems", { ...root, itemId: "bad id" })],
    ["別科目への前提関係", "所属科目", () => put("prerequisites", new Prerequisite({ itemId: "i2", prereqItemId: "i5", studentId: sid }))],
    ["後続ノートの別所有者", "note", () => put("notes", new Note({ noteId: "n2", itemId: "i2", studentId: other }))],
    ["後続テストの解答参照不正", "answer → question", () => { const t = structuredClone(test); t.testId = "t4"; t.itemId = "i2"; t.questions[0].testId = "t4"; t.attempts[0].testId = "t4"; t.attempts[0].answers[0].questionId = "missing"; return put("tests", t); }],
    ["後続資料の別所有者", "material", () => put("materials", new Material({ materialId: "bad", itemId: "i2", studentId: other }))],
    ["科目削除ログの別所有者", "deletions", () => put("deletions", { ...oldLog, studentId: other })],
    ["学習項目削除ログの別所有者", "deletions", () => put("deletions", { ...oldLog, table: "learning_item", key: "i2", studentId: other })],
  ];
  it.each(invalid)("%sなら一切変更しない", async (_name, message, mutate) => {
    await mutate();
    await rejectUnchanged(message);
  });
  it("最後の科目ログ書込後にabortしても全体を巻き戻す", async () => {
    await put("deletions", oldLog);
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const req = original.call(this, value, key);
      if (this.name === "deletions" && (value as Deletion).table === "subject") {
        req.addEventListener("success", () => this.transaction.abort(), { once: true });
      }
      return req;
    });
    try { await rejectUnchanged(); } finally { spy.mockRestore(); }
    expect(await get("deletions", ["subject", "s1"])).toEqual(oldLog);
    expect(await get("materialContents", "m1")).toBe("消す資料の合成データ");
  });
  it("既存の同所有者ログは科目・学習項目とも新版に更新する", async () => {
    await put("deletions", oldLog);
    await put("deletions", { ...oldLog, table: "learning_item", key: "i2" });
    await manager.deleteSubject("s1");
    for (const key of [["subject", "s1"], ["learning_item", "i2"]]) {
      const saved = await get<Deletion>("deletions", key);
      expect(saved?.revision).toMatch(/^[a-f0-9]{32}$/);
      expect(saved?.revision).not.toBe(oldLog.revision);
    }
  });
});
