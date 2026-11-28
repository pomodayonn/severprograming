// SYNC-07a: fake-indexeddbだけを使った削除ログ消費の回帰試験。
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { acknowledgeDeletion, editPrerequisites, get, put, recordDeletion, type Deletion } from "../../src/dao/idb";

const studentId = "student-a";
const at = "2026-11-25T00:00:00.000Z";
const legacy = (key: string): Deletion => ({ table: "test", key, studentId, at });
const read = (table: string, key: string) => get<Deletion>("deletions", [table, key]);

describe("SYNC-07a：IndexedDBで削除ログを条件付き消費する", () => {
  it("現在の版と一致する削除ログだけを消費する", async () => {
    await recordDeletion("test", "normal", studentId);
    const sent = (await read("test", "normal"))!;
    expect(sent.revision).toMatch(/^[a-f0-9]{32}$/);
    expect(await acknowledgeDeletion(sent)).toBe(true);
    expect(await read("test", "normal")).toBeUndefined();
  });

  it("旧形式の削除ログも一致していれば消費できる", async () => {
    const sent = legacy("legacy");
    await put("deletions", sent);
    expect(await acknowledgeDeletion(sent)).toBe(true);
    expect(await read("test", sent.key)).toBeUndefined();
  });

  it("同一ミリ秒に再登録された新版を古い通知で消さない", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(at));
      await recordDeletion("test", "same-time", studentId);
      const sent = (await read("test", "same-time"))!;
      // 新版の書込みと旧版の消費を連続して要求する。
      const writing = recordDeletion("test", "same-time", studentId);
      const ack = acknowledgeDeletion(sent);
      await writing;
      expect(await ack).toBe(false);
      const current = (await read("test", "same-time"))!;
      expect(current.at).toBe(sent.at);
      expect(current.revision).not.toBe(sent.revision);
      expect(await acknowledgeDeletion(current)).toBe(true);
      expect(await read("test", "same-time")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一キーでも所有者が違えば消費しない", async () => {
    const sent = legacy("owner");
    const current = { ...sent, studentId: "student-b" };
    await put("deletions", current);
    expect(await acknowledgeDeletion(sent)).toBe(false);
    expect(await read("test", sent.key)).toEqual(current);
  });

  it("旧形式でも削除日時が変わっていれば消費しない", async () => {
    const sent = legacy("time");
    const current = { ...sent, at: "2026-11-26T00:00:00.000Z" };
    await put("deletions", current);
    expect(await acknowledgeDeletion(sent)).toBe(false);
    expect(await read("test", sent.key)).toEqual(current);
  });

  it("消費済みまたは存在しないログは成功扱いしない", async () => {
    expect(await acknowledgeDeletion(legacy("absent"))).toBe(false);
  });

  it("前提関係編集の削除ログにも新版識別子を付ける", async () => {
    const link = { itemId: "i1", prereqItemId: "i2" };
    const plan = () => ({ studentId, add: [], remove: [link] });
    await put("prerequisites", { ...link, studentId, updatedAt: at });
    await editPrerequisites(plan);
    const sent = (await read("prerequisite", "i1|i2"))!;
    expect(sent.revision).toMatch(/^[a-f0-9]{32}$/);
    await put("prerequisites", { ...link, studentId, updatedAt: at });
    await editPrerequisites(plan);
    const current = (await read("prerequisite", "i1|i2"))!;
    expect(current.revision).not.toBe(sent.revision);
    expect(await acknowledgeDeletion(sent)).toBe(false);
    expect(await read("prerequisite", "i1|i2")).toEqual(current);
  });
});
