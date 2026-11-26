// 単体テスト：ノートの端末保存とクラウド同期の結果
// SYNC-02・SYNC-04 の回帰テスト。
// 実際の Neon や IndexedDB へのアクセスは行わない。

import { describe, expect, it, vi } from "vitest";

import {
  NoteManager,
  type NoteSyncer,
} from "../../src/managers/NoteManager";

import {
  SyncManager,
  SyncError,
} from "../../src/managers/SyncManager";

import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Student } from "../../src/beans/Student";
import { PartType } from "../../src/enums/PartType";

import type { NoteDAO } from "../../src/dao/NoteDAO";
import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";

const studentId = "student-1";
const itemId = "item-1";

const student = new Student({ studentId });

const part = new NotePart({
  partId: "part-1",
  partType: PartType.TEXT,
  text: "保存するノートの内容",
});

function setup(withSync = true) {
  const original = new Note({
    noteId: "note-1",
    studentId,
    itemId,
    parts: [],
  });

  const saved = new Note({
    ...original,
    parts: [part],
  });

  const dao = {
    findByItem: vi.fn().mockResolvedValue(original),
    save: vi.fn().mockResolvedValue(saved),
  };

  const sync = {
    pushChanges: vi.fn().mockResolvedValue(undefined),
    sendAll: vi.fn().mockResolvedValue(true),
    keepMineNote: vi.fn().mockResolvedValue(undefined),
    takeRemoteNote: vi.fn().mockResolvedValue(null),
  };

  const manager = new NoteManager(
    dao as unknown as NoteDAO,
    withSync ? (sync as NoteSyncer) : null
  );

  return { manager, dao, sync, saved };
}

describe("saveParts：端末保存と同期結果", () => {
  it("端末保存と同期確認が成功する", async () => {
    const { manager, dao, sync, saved } = setup();

    const result = await manager.saveParts(
      studentId,
      itemId,
      [part]
    );

    expect(result.note).toEqual(saved);
    expect(result.syncConfirmed).toBe(true);

    expect(dao.save).toHaveBeenCalledOnce();
    expect(sync.sendAll).toHaveBeenCalledOnce();

    // 端末への保存がクラウド同期より先に行われる。
    expect(
      dao.save.mock.invocationCallOrder[0]
    ).toBeLessThan(
      sync.sendAll.mock.invocationCallOrder[0]
    );
  });

  it("同期に失敗しても端末への保存結果を維持する", async () => {
    const { manager, dao, sync, saved } = setup();

    sync.sendAll.mockResolvedValue(false);

    const result = await manager.saveParts(
      studentId,
      itemId,
      [part]
    );

    expect(result.note).toEqual(saved);
    expect(result.syncConfirmed).toBe(false);
    expect(dao.save).toHaveBeenCalledOnce();
  });

  it("同期処理で例外が発生しても端末保存を維持する", async () => {
    const { manager, sync, saved } = setup();

    sync.sendAll.mockRejectedValue(
      new Error("通信エラー")
    );

    const result = await manager.saveParts(
      studentId,
      itemId,
      [part]
    );

    expect(result.note).toEqual(saved);
    expect(result.syncConfirmed).toBe(false);
  });

  it("同期設定がなくても端末に保存できる", async () => {
    const { manager, sync, saved } = setup(false);

    const result = await manager.saveParts(
      studentId,
      itemId,
      [part]
    );

    expect(result.note).toEqual(saved);
    expect(result.syncConfirmed).toBe(false);
    expect(sync.sendAll).not.toHaveBeenCalled();
  });

  it("端末への保存に失敗した場合は同期を行わない", async () => {
    const { manager, dao, sync } = setup();

    dao.save.mockRejectedValue(
      new Error("IndexedDB保存エラー")
    );

    await expect(
      manager.saveParts(studentId, itemId, [part])
    ).rejects.toThrow("IndexedDB保存エラー");

    expect(sync.sendAll).not.toHaveBeenCalled();
  });
});

function setupSync() {
  const auth = {
    neon: true,
    getSession: vi.fn<() => Promise<Student | null>>()
      .mockResolvedValue(student),
  };

  const sync = new SyncManager(
    auth as unknown as NeonAuthClient,
    "https://example.invalid"
  );

  return { auth, sync };
}

describe("SyncManager：不完全な同期の判定", () => {
  it("書式情報を除外する状態では同期確認済みにしない", async () => {
    const { sync } = setupSync();

    const push = vi.spyOn(sync, "pushChanges")
      .mockResolvedValue(undefined);

    // 書式列がないと判定された内部状態を再現する。
    Reflect.set(sync, "noStyleColumn", true);

    expect(await sync.sendAll()).toBe(false);
    expect(push).toHaveBeenCalledOnce();
  });

  it("セッションが存在しなければ同期エラーになる", async () => {
    const { auth, sync } = setupSync();

    auth.getSession.mockResolvedValue(null);

    await expect(
      sync.pushChanges()
    ).rejects.toBeInstanceOf(SyncError);
  });

  it("同期途中でセッションが失われたら false を返す", async () => {
    const { auth, sync } = setupSync();

    auth.getSession
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(null);

    expect(await sync.sendAll()).toBe(false);
  });
});
