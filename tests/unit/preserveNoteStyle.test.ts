// 単体テスト：ノート同期時の書式情報の保護
// SYNC-03 の回帰テスト。
// IndexedDB と HTTP 通信をモック化し、実際の Neon には接続しない。

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

import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Student } from "../../src/beans/Student";
import { PartType } from "../../src/enums/PartType";
import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";

import {
  get,
  getAll,
  getAllBy,
  put,
} from "../../src/dao/idb";

// IndexedDB の代替処理
vi.mock("../../src/dao/idb", () => ({
  get: vi.fn(),
  getAll: vi.fn(),
  getAllBy: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  replaceStudentData: vi.fn(),
}));

const studentId = "student-1";

const previousSync = "2026-11-25T00:00:00.000Z";
const updatedAt = "2026-11-26T00:00:00.000Z";

const lastSyncKey = `lastSyncedAt:${studentId}`;

const style = JSON.stringify({
  align: "center",
  runs: [
    {
      s: 0,
      e: 4,
      b: true,
      c: "#ff0000",
      z: 14,
    },
  ],
});

const note = new Note({
  noteId: "note-1",
  studentId,
  itemId: "item-1",
  updatedAt,
  lastSavedAt: updatedAt,
  parts: [
    new NotePart({
      partId: "part-1",
      studentId,
      noteId: "note-1",
      partType: PartType.TEXT,
      text: "テスト用の文字",
      style,
      width: 300,
      height: 50,
    }),
    new NotePart({
      partId: "part-2",
      studentId,
      noteId: "note-1",
      partType: PartType.SHAPE,
      shape: "ellipse",
      width: 90,
      height: 90,
    }),
  ],
});

interface HttpCall {
  method: string;
  path: string;
  body: unknown;
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(get).mockImplementation(
    async (_store, key) =>
      key === lastSyncKey
        ? previousSync
        : undefined
  );

  vi.mocked(getAll).mockImplementation(
    async store => store === "notes" ? [note] : []
  );

  vi.mocked(getAllBy).mockResolvedValue([]);
  vi.mocked(put).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
   const auth = {
    neon: true,

    getSession: vi.fn<
      () => Promise<Student | null>
    >().mockResolvedValue(
      new Student({ studentId })
    ),

    getAccessToken: vi.fn()
      .mockResolvedValue("mock-token"),

    getSyncSession: vi.fn<
      () => Promise<{
        studentId: string;
        token: string;
      } | null>
    >().mockResolvedValue({
      studentId,
      token: "mock-token",
    }),
  };

  const sync = new SyncManager(
    auth as unknown as NeonAuthClient,
    "https://example.invalid"
  );

  const calls: HttpCall[] = [];

  const failures = {
    schema: false,
    partSave: false,
  };

  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const parsed = new URL(url);
      const path = parsed.pathname + parsed.search;

      const body = init?.body
        ? JSON.parse(String(init.body))
        : undefined;

      calls.push({ method, path, body });

      // 必要カラムの事前確認
      if (
        method === "GET" &&
        path === "/note_part?select=shape,style&limit=1"
      ) {
        return new Response("[]", {
          status: failures.schema ? 400 : 200,
        });
      }

      // ノート本体の保存
      if (method === "POST" && path === "/note") {
        return new Response(
          JSON.stringify([{ updated_at: updatedAt }]),
          { status: 200 }
        );
      }

      // ノート部品の保存
      if (method === "POST" && path === "/note_part") {
        return new Response(null, {
          status: failures.partSave ? 400 : 204,
        });
      }

      // 不要なノート部品・単語の削除
      if (
        method === "DELETE" &&
        (
          path.startsWith("/note_part?") ||
          path.startsWith("/word?")
        )
      ) {
        return new Response(null, { status: 204 });
      }

      // 想定外の通信は成功扱いにしない。
      throw new Error(
        `想定外の通信：${method} ${path}`
      );
    }
  );

  vi.stubGlobal("fetch", fetchMock);

  return { sync, calls, failures };
}

describe("SYNC-03：ノートの書式情報を保護する", () => {
  it("必要カラムを確認できなければノートを更新しない", async () => {
    const { sync, calls, failures } = setup();

    failures.schema = true;

    await expect(sync.pushChanges())
      .rejects.toBeInstanceOf(SyncError);

    expect(calls.map(c => c.method))
      .toEqual(["GET"]);

    expect(calls[0].path)
      .toBe("/note_part?select=shape,style&limit=1");

    expect(put).not.toHaveBeenCalled();

    expect(sync.lastSyncedAt)
      .toBe(previousSync);
  });

  it("部品保存がHTTP 400なら書式を除外して再送信しない", async () => {
    const { sync, calls, failures } = setup();

    failures.partSave = true;

    expect(await sync.sendAll()).toBe(false);

    const partCalls = calls.filter(
      c => c.method === "POST" &&
        c.path === "/note_part"
    );

    // 書式を除外した2回目の送信は行わない。
    expect(partCalls).toHaveLength(1);

    expect(partCalls[0].body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          part_id: "part-1",
          style,
        }),
      ])
    );

    // 部品保存に失敗した場合は削除も行わない。
    expect(
      calls.some(
        c => c.method === "DELETE"
      )
    ).toBe(false);

    expect(put).not.toHaveBeenCalled();

    expect(sync.lastSyncedAt)
      .toBe(previousSync);
  });

  it("書式と図形を保持して部品保存後に削除する", async () => {
    const { sync, calls } = setup();

    expect(await sync.sendAll()).toBe(true);

    const partIndex = calls.findIndex(
      c => c.method === "POST" &&
        c.path === "/note_part"
    );

    const deleteIndex = calls.findIndex(
      c => c.method === "DELETE" &&
        c.path.startsWith("/note_part?")
    );

    expect(partIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(partIndex);

    expect(calls[partIndex].body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          part_id: "part-1",
          style,
          shape: null,
        }),
        expect.objectContaining({
          part_id: "part-2",
          shape: "ellipse",
          style: "",
        }),
      ])
    );

    expect(put).toHaveBeenCalledWith(
      "meta",
      expect.any(String),
      lastSyncKey
    );
  });

  it("カラム確認失敗後も次回の同期を試行できる", async () => {
    const { sync, calls, failures } = setup();

    failures.schema = true;

    expect(await sync.sendAll()).toBe(false);

    expect(sync.lastSyncedAt)
      .toBe(previousSync);

    expect(put).not.toHaveBeenCalled();

    // 次回は必要カラムを参照できる状態にする。
    failures.schema = false;
    calls.length = 0;

    expect(await sync.sendAll()).toBe(true);

    expect(calls[0].method).toBe("GET");

    expect(calls[0].path)
      .toBe("/note_part?select=shape,style&limit=1");

    expect(
      calls.some(
        c => c.method === "POST" &&
          c.path === "/note_part"
      )
    ).toBe(true);

    expect(sync.lastSyncedAt)
      .not.toBe(previousSync);

    expect(put).toHaveBeenCalledWith(
      "meta",
      expect.any(String),
      lastSyncKey
    );
  });
});
