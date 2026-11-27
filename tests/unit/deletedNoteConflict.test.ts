// 単体テスト：別端末で削除された競合ノートの保護
// SYNC-08 の回帰テスト。
// 実際の Neon や IndexedDB にはアクセスしない。

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SyncManager,
  SyncError,
} from "../../src/managers/SyncManager";

import { AppError } from "../../src/managers/common";
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Student } from "../../src/beans/Student";
import { PartType } from "../../src/enums/PartType";

import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";

import {
  get,
  put,
  del,
  replaceStudentData,
} from "../../src/dao/idb";

vi.mock("../../src/dao/idb", () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getAll: vi.fn(),
  getAllBy: vi.fn(),
  replaceStudentData: vi.fn(),
}));

const studentId = "student-1";
const noteId = "note-1";
const itemId = "item-1";

const oldVersion = "2026-11-25T00:00:00.000Z";
const remoteVersion = "2026-11-26T00:00:00.000Z";

const student = new Student({ studentId });

const localNote = new Note({
  noteId,
  studentId,
  itemId,
  updatedAt: remoteVersion,
  parts: [
    new NotePart({
      partId: "part-1",
      partType: PartType.TEXT,
      text: "端末に残したいノート",
    }),
  ],
});

const remoteNote = {
  student_id: studentId,
  note_id: noteId,
  item_id: itemId,
  updated_at: remoteVersion,
  last_saved_at: remoteVersion,
};

const basesKey = `noteBases:${studentId}`;
const conflictsKey = `noteConflicts:${studentId}`;
const lastPulledKey = `lastPulledAt:${studentId}`;

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(put).mockResolvedValue(undefined);
  vi.mocked(del).mockResolvedValue(undefined);

  vi.mocked(replaceStudentData)
    .mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(
  remoteExists = true,
  hasConflict = true
) {
  const auth = {
    neon: true,
    getSession: vi.fn<() => Promise<Student | null>>()
      .mockResolvedValue(student),
    getAccessToken: vi.fn()
      .mockResolvedValue("mock-token"),
  };

  const sync = new SyncManager(
    auth as unknown as NeonAuthClient,
    "https://example.invalid"
  );

  // 今回は受け取りと競合解決の処理を中心に検証する。
  vi.spyOn(sync, "pushChanges")
    .mockResolvedValue(undefined);

  vi.mocked(get).mockImplementation(
    async (store, key) => {
      if (store === "notes" && key === noteId) {
        return localNote;
      }

      if (store === "meta") {
        if (key === basesKey) {
          return { [noteId]: oldVersion };
        }

        if (key === conflictsKey) {
          return hasConflict ? [noteId] : [];
        }
      }

      return undefined;
    }
  );

  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const method = init?.method ?? "GET";

      if (method !== "GET") {
        throw new Error(
          `想定外の更新処理：${method}`
        );
      }

      let rows: unknown[];

      switch (parsed.pathname) {
        case "/note":
          rows = remoteExists
            ? [remoteNote]
            : [];
          break;

        case "/subject":
          rows = [{
            student_id: studentId,
            subject_id: "subject-1",
            subject_name: "テスト科目",
          }];
          break;

        case "/learning_item":
          rows = [{
            student_id: studentId,
            item_id: itemId,
            subject_id: "subject-1",
            item_name: "テスト項目",
          }];
          break;

        case "/note_part":
        case "/word":
        case "/prerequisite":
        case "/test":
        case "/question":
        case "/attempt":
        case "/answer":
          rows = [];
          break;

        default:
          throw new Error(
            `想定外の通信：${parsed.pathname}`
          );
      }

      return new Response(
        JSON.stringify(rows),
        { status: 200 }
      );
    }
  );

  vi.stubGlobal("fetch", fetchMock);

  return { sync, auth, fetchMock };
}

describe("SYNC-08：削除を伴う競合のデータ保護", () => {
  it("クラウドにない競合ノートを端末から消さない", async () => {
    const { sync } = setup(false, true);

    await expect(sync.pullAll())
      .rejects.toThrow("端末のデータを保護");

    // 端末データの置き換えを実行しない。
    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("通常の競合では端末のノートと競合情報を保持する", async () => {
    const { sync } = setup(true, true);

    await sync.pullAll();

    expect(replaceStudentData)
      .toHaveBeenCalledOnce();

    expect(replaceStudentData)
      .toHaveBeenCalledWith(
        studentId,
        expect.objectContaining({
          notes: [localNote],
        }),
        expect.objectContaining({
          [basesKey]: {
            [noteId]: oldVersion,
          },
          [conflictsKey]: [noteId],
        })
      );
  });

  it("削除済みノートへの上書きを拒否する", async () => {
    const { sync } = setup(false, true);

    await expect(
      sync.keepMineNote(noteId)
    ).rejects.toThrow("上書きできません");

    // 元の同期情報と競合情報を変更しない。
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("削除済みノートの受け取りで競合情報を解除しない", async () => {
    const { sync } = setup(false, true);

    const result = sync.takeRemoteNote(noteId);

    await expect(result)
      .rejects.toBeInstanceOf(SyncError);

    // Controller が画面へエラーを伝えられる型である。
    await expect(result)
      .rejects.toBeInstanceOf(AppError);

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();

    expect(replaceStudentData)
      .not.toHaveBeenCalled();
  });

  it("セッションがなければ競合解決を行わない", async () => {
    const { sync, auth, fetchMock } = setup();

    auth.getSession.mockResolvedValue(null);

    await expect(
      sync.keepMineNote(noteId)
    ).rejects.toBeInstanceOf(SyncError);

    await expect(
      sync.takeRemoteNote(noteId)
    ).rejects.toBeInstanceOf(SyncError);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("競合がない場合は通常どおり受け取る", async () => {
    const { sync } = setup(true, false);

    await sync.pullAll();

    expect(replaceStudentData)
      .toHaveBeenCalledOnce();

    expect(replaceStudentData)
      .toHaveBeenCalledWith(
        studentId,
        expect.objectContaining({
          notes: [
            expect.objectContaining({
              noteId,
              studentId,
              itemId,
              parts: [],
            }),
          ],
        }),
        expect.objectContaining({
          [basesKey]: {
            [noteId]: remoteVersion,
          },
          [conflictsKey]: [],
          [lastPulledKey]: expect.any(String),
        })
      );
  });
});
describe("DB-02a：受信データの所有者確認", () => {
  it.each([
    [
      "/subject",
      { student_id: "other-student" },
    ],
    [
      "/word",
      { student_id: "other-student" },
    ],
    [
      "/note",
      { note_id: "unknown-owner" },
    ],
  ])(
    "%s に不正な所有者のデータがあれば置換しない",
    async (path, row) => {
      const { sync, fetchMock } = setup(true, false);

      const original =
        fetchMock.getMockImplementation()!;

      fetchMock.mockImplementation(
        async (url, init) => {
          if (new URL(url).pathname === path) {
            return new Response(
              JSON.stringify([row]),
              { status: 200 }
            );
          }

          return original(url, init);
        }
      );

      await expect(sync.pullAll())
        .rejects.toThrow("所有者が一致しない");

      expect(replaceStudentData)
        .not.toHaveBeenCalled();

      expect(put).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    }
  );

  it("送信後にアカウントが変わった場合は受信しない", async () => {
    const { sync, auth, fetchMock } =
      setup(true, false);

    auth.getSession
      .mockResolvedValueOnce(student)
      .mockResolvedValue(
        new Student({
          studentId: "other-student",
        })
      );

    await expect(sync.pullAll())
      .rejects.toThrow("ログイン状態が変更");

    expect(fetchMock)
      .not.toHaveBeenCalled();

    expect(replaceStudentData)
      .not.toHaveBeenCalled();
  });

  it("受信後にログアウトしていた場合は置換しない", async () => {
    const { sync, auth } = setup(true, false);

    auth.getSession
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(student)
      .mockResolvedValue(null);

    await expect(sync.pullAll())
      .rejects.toThrow("ログイン状態が変更");

    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
