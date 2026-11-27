// 単体テスト：同期失敗後の再試行と送信順序
// SYNC-10 の回帰テスト。
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

import { Student } from "../../src/beans/Student";
import { Subject } from "../../src/beans/Subject";

import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";

import {
  get,
  getAll,
  getAllBy,
  put,
  del,
  replaceStudentData,
} from "../../src/dao/idb";

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
const conflictsKey = `noteConflicts:${studentId}`;

const student = new Student({ studentId });

const subject = new Subject({
  subjectId: "subject-1",
  studentId,
  subjectName: "再試行テスト用科目",
  createdAt: updatedAt,
  updatedAt,
});

const meta = new Map<string, unknown>();

beforeEach(() => {
  vi.resetAllMocks();

  meta.clear();
  meta.set(lastSyncKey, previousSync);
  meta.set(conflictsKey, []);

  // 同期日時と競合情報を模擬的に保存する。
  vi.mocked(get).mockImplementation(
    async (_store, key) => meta.get(String(key))
  );

  vi.mocked(put).mockImplementation(
    async (store, value, key) => {
      if (store === "meta") {
        meta.set(String(key), value);
      }
    }
  );

  vi.mocked(getAll).mockImplementation(
    async store => store === "subjects"
      ? [subject]
      : []
  );

  vi.mocked(getAllBy).mockResolvedValue([]);
  vi.mocked(del).mockResolvedValue(undefined);

  vi.mocked(replaceStudentData)
    .mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const auth = {
    neon: true,

    getSession: vi.fn()
      .mockResolvedValue(student),

    getAccessToken: vi.fn()
      .mockResolvedValue("mock-token"),
  };

  const sync = new SyncManager(
    auth as unknown as NeonAuthClient,
    "https://example.invalid"
  );

  const fetchMock = vi.fn(
    async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);

      if (
        parsed.pathname === "/subject" &&
        init?.method === "POST"
      ) {
        return new Response(null, {
          status: 204,
        });
      }

      throw new Error(
        `想定外の通信：${init?.method} ${url}`
      );
    }
  );

  vi.stubGlobal("fetch", fetchMock);

  return { sync, auth, fetchMock };
}

describe("SYNC-10：同期失敗後の再試行", () => {
  it("通信失敗後に同じデータを再送信できる", async () => {
    const { sync, fetchMock } = setup();

    // 最初の送信だけ失敗させる。
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 503 })
    );

    expect(await sync.sendAll()).toBe(false);

    // 失敗時は同期日時を進めない。
    expect(meta.get(lastSyncKey))
      .toBe(previousSync);

    expect(put).not.toHaveBeenCalled();

    // 再試行では同じデータが送信される。
    expect(await sync.sendAll()).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody =
      fetchMock.mock.calls[0][1]?.body;

    const secondBody =
      fetchMock.mock.calls[1][1]?.body;

    expect(secondBody).toBe(firstBody);

    expect(meta.get(lastSyncKey))
      .not.toBe(previousSync);
  });

  it("先行する送信が失敗しても後続の送信を実行する", async () => {
    const { sync, fetchMock } = setup();

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 503 })
    );

    // 2件の送信要求を続けて発行する。
    const first = sync.pushChanges();
    const second = sync.pushChanges();

    const results = await Promise.allSettled([
      first,
      second,
    ]);

    expect(results[0].status)
      .toBe("rejected");

    if (results[0].status === "rejected") {
      expect(results[0].reason)
        .toBeInstanceOf(SyncError);
    }

    expect(results[1].status)
      .toBe("fulfilled");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(meta.get(lastSyncKey))
      .not.toBe(previousSync);
  });

  it("先行する送信が終わるまで後続の送信を開始しない", async () => {
    const { sync, auth, fetchMock } = setup();

    let start!: () => void;
    let release!: () => void;

    const started = new Promise<void>(
      resolve => { start = resolve; }
    );

    const waiting = new Promise<void>(
      resolve => { release = resolve; }
    );

    // 最初の通信を意図的に待機させる。
    fetchMock.mockImplementationOnce(
      async () => {
        start();
        await waiting;

        return new Response(null, {
          status: 204,
        });
      }
    );

    const first = sync.pushChanges();
    const second = sync.pushChanges();

    await started;

    try {
      expect(fetchMock)
        .toHaveBeenCalledTimes(1);

      // 2件目の push() はまだ開始していない。
      expect(auth.getSession)
        .toHaveBeenCalledTimes(1);
    } finally {
      release();
    }

    await Promise.all([first, second]);

    // 2件目の送信処理も実行された。
    expect(auth.getSession)
      .toHaveBeenCalledTimes(2);

    // 1件目で送信済みなので重複送信しない。
    expect(fetchMock)
      .toHaveBeenCalledTimes(1);
  });

  it("未解決の競合が残っていれば同期確認済みにしない", async () => {
    const { sync } = setup();

    meta.set(conflictsKey, ["note-1"]);

    expect(await sync.sendAll()).toBe(false);

    // 再送信によって競合情報を消さない。
    expect(meta.get(conflictsKey))
      .toEqual(["note-1"]);

    expect(replaceStudentData)
      .not.toHaveBeenCalled();
  });

  it("再送信では受け取りや端末データの一括置換を行わない", async () => {
    const { sync, fetchMock } = setup();

    expect(await sync.sendAll()).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.invalid/subject",
      expect.objectContaining({
        method: "POST",
      })
    );

    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(del).not.toHaveBeenCalled();
  });
});
