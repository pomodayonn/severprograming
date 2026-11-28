// SYNC-07c: fake-indexeddbのみ。実データ・外部サービスを使用しない。
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, put, get, del, readPushSnapshot, replaceStudentData, recordDeletion } from "../../src/dao/idb";
import { Subject } from "../../src/beans/Subject";
import { LearningItem } from "../../src/beans/LearningItem";
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";

const sid = "student-a";
const at = "2026-11-25T00:00:00.000Z";
const metaKey = "lastPulledAt:" + sid;
const stores = ["subjects", "learningItems", "prerequisites", "notes", "tests", "deletions", "meta"];
const subject = new Subject({ subjectId: "s1", studentId: sid, subjectName: "端末の科目", updatedAt: at });
const item = new LearningItem({ itemId: "i1", subjectId: "s1", studentId: sid, updatedAt: at });
const note = new Note({ noteId: "n1", itemId: "i1", studentId: sid, updatedAt: at, parts: [new NotePart({ partId: "p1", noteId: "n1", studentId: sid, text: "端末の内容" })] });
const incoming = () => ({ subjects: [new Subject({ ...subject, subjectName: "クラウドの科目" })], learningItems: [item], prerequisites: [], notes: [new Note({ ...note, parts: [] })], tests: [] });
const meta = { [metaKey]: "new" };
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("aborted"));
  tx.onerror = () => reject(tx.error ?? new Error("failed"));
});

beforeEach(async () => {
  const db = await openDb();
  const tx = db.transaction(stores, "readwrite");
  const done = completed(tx);
  for (const name of stores) tx.objectStore(name).clear();
  await done;
  await put("subjects", subject);
  await put("learningItems", item);
  await put("notes", note);
  await put("meta", "old", metaKey);
});

async function expectRejected(before: Awaited<ReturnType<typeof readPushSnapshot>>) {
  const current = await readPushSnapshot(sid);
  expect(await replaceStudentData(sid, incoming(), meta, before)).toBe(false);
  expect(await readPushSnapshot(sid)).toEqual(current);
  expect(await get("meta", metaKey)).toBe("old");
}

describe("SYNC-07c：置換時の条件付き保護", () => {
  it("端末の変更がなければデータと同期情報を置換する", async () => {
    const before = await readPushSnapshot(sid);
    expect(await replaceStudentData(sid, incoming(), meta, before)).toBe(true);
    expect(await get("subjects", "s1")).toMatchObject({ subjectName: "クラウドの科目" });
    expect(await get("notes", "n1")).toMatchObject({ parts: [] });
    expect(await get("meta", metaKey)).toBe("new");
  });
  it("更新日時が同じでもノートの部品が変われば置換しない", async () => {
    const before = await readPushSnapshot(sid);
    const changed = structuredClone(note);
    changed.parts[0].text = "同一ミリ秒の編集";
    await put("notes", changed);
    await expectRejected(before);
  });
  it("新しい学習項目が追加されたら置換しない", async () => {
    const before = await readPushSnapshot(sid);
    await put("learningItems", new LearningItem({ ...item, itemId: "i2" }));
    await expectRejected(before);
  });
  it("削除ログ登録前でも端末行が消えていれば置換しない", async () => {
    const before = await readPushSnapshot(sid);
    await del("notes", "n1");
    await expectRejected(before);
  });
  it("端末行が同じでも未送信の削除ログがあれば置換しない", async () => {
    const before = await readPushSnapshot(sid);
    await recordDeletion("test", "deleted-test", sid);
    await expectRejected(before);
  });
  it("別アカウントの変更と削除ログは今回の照合を妨げない", async () => {
    const before = await readPushSnapshot(sid);
    const other = new Subject({ subjectId: "other", studentId: "student-b", subjectName: "別の科目" });
    await put("subjects", other);
    await recordDeletion("test", "other-test", "student-b");
    expect(await replaceStudentData(sid, incoming(), meta, before)).toBe(true);
    expect(await get("subjects", "other")).toMatchObject({ studentId: "student-b", subjectName: "別の科目" });
    expect(await get("deletions", ["test", "other-test"])).toMatchObject({ studentId: "student-b" });
  });
  it("先行する書込トランザクションの編集も置換時に検出する", async () => {
    const before = await readPushSnapshot(sid);
    const db = await openDb();
    const tx = db.transaction("subjects", "readwrite");
    const written = completed(tx);
    tx.objectStore("subjects").put({ ...subject, subjectName: "先行する編集" });
    const replacing = replaceStudentData(sid, incoming(), meta, before);
    const [, result] = await Promise.all([written, replacing]);
    expect(result).toBe(false);
    expect(await get("subjects", "s1")).toMatchObject({ subjectName: "先行する編集" });
    expect(await get("meta", metaKey)).toBe("old");
  });
  it("送信によって元の削除ログが消費済みなら置換を許可する", async () => {
    await recordDeletion("test", "sent-test", sid);
    const before = await readPushSnapshot(sid);
    // 合成データで正常な送信後の状態を作る。
    await del("deletions", ["test", "sent-test"]);
    expect(await replaceStudentData(sid, incoming(), meta, before)).toBe(true);
    expect(await get("meta", metaKey)).toBe("new");
  });
});
