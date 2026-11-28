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
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Word } from "../../src/beans/Word";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { Attempt } from "../../src/beans/Attempt";
import { Answer } from "../../src/beans/Answer";
import { PartType } from "../../src/enums/PartType";

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

     // 2件とも要求時点で学生IDを取得する。
      // ただし、HTTP通信はまだ1件目だけ。
      expect(auth.getSession)
        .toHaveBeenCalledTimes(2);
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

describe("SYNC-11・12：同期時の所有者管理", () => {
  it("送信データに学生IDを明示する", async () => {
    const { sync, fetchMock } = setup();

    await sync.pushChanges();

    expect(fetchMock).toHaveBeenCalledOnce();

    const init = fetchMock.mock.calls[0][1];

    expect(
      JSON.parse(String(init?.body))
    ).toEqual([
      expect.objectContaining({
        subject_id: "subject-1",
        student_id: studentId,
      }),
    ]);

    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer mock-token",
      })
    );
  });

  it("別アカウントの認証情報では送信しない", async () => {
    const { sync, auth, fetchMock } = setup();

    auth.getSyncSession.mockResolvedValue({
      studentId: "other-student",
      token: "other-token",
    });

    await expect(sync.pushChanges())
      .rejects.toThrow("ログイン状態が変更");

    expect(fetchMock).not.toHaveBeenCalled();

    expect(meta.get(lastSyncKey))
      .toBe(previousSync);

    expect(put).not.toHaveBeenCalled();
  });

  it("送信完了直後のログアウトで同期日時を更新しない", async () => {
    const { sync, auth, fetchMock } = setup();

    fetchMock.mockImplementationOnce(
      async () => {
        auth.getSyncSession
          .mockResolvedValue(null);

        return new Response(null, {
          status: 204,
        });
      }
    );

    await expect(sync.pushChanges())
      .rejects.toThrow("ログイン状態が変更");

    expect(fetchMock).toHaveBeenCalledOnce();

    expect(meta.get(lastSyncKey))
      .toBe(previousSync);

    expect(put).not.toHaveBeenCalled();
  });

  it("待ち行列の同期を別アカウントで実行しない", async () => {
    const { sync, auth, fetchMock } = setup();

    let start!: () => void;
    let release!: () => void;

    const started = new Promise<void>(
      resolve => { start = resolve; }
    );

    const waiting = new Promise<void>(
      resolve => { release = resolve; }
    );

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

    const settled = Promise.allSettled([
      first,
      second,
    ]);

    await started;

    auth.getSession.mockResolvedValue(
      new Student({
        studentId: "other-student",
      })
    );

    auth.getSyncSession.mockResolvedValue({
      studentId: "other-student",
      token: "other-token",
    });

    release();

    const results = await settled;

    expect(
      results.map(r => r.status)
    ).toEqual([
      "rejected",
      "rejected",
    ]);

    // 2件目を別アカウントとして送信しない。
    expect(fetchMock).toHaveBeenCalledOnce();

    expect(meta.get(lastSyncKey))
      .toBe(previousSync);
  });
});

// SYNC-14a: 保存済みの入れ子データを使う合成フィクスチャ。
// fetchはすべてモック化しており、実データ・外部サービスは使用しない。
describe("SYNC-14a：送信前の子データ検証", () => {
  function fixture() {
    const word = new Word({ wordId: "w1", studentId, partId: "p1", term: "HTTP", meaning: "通信規約" });
    const part = new NotePart({ partId: "p1", studentId, noteId: "n1", partType: PartType.FRAME, frameType: "word", width: 100, height: 50, words: [word] });
    const note = new Note({ noteId: "n1", studentId, itemId: "i1", updatedAt, lastSavedAt: updatedAt, parts: [part] });
    const question = new Question({ questionId: "q1", studentId, testId: "t1", number: 1, questionText: "通信規約", modelAnswer: "HTTP" });
    const answer = new Answer({ answerId: "a1", studentId, attemptId: "r1", questionId: "q1", studentAnswer: "HTTP", correct: true, answeredAt: updatedAt });
    const attempt = new Attempt({ attemptId: "r1", studentId, testId: "t1", attemptNo: 1, takenAt: updatedAt, answers: [answer] });
    const test = new Test({ testId: "t1", studentId, itemId: "i1", createdAt: updatedAt, updatedAt, lastTakenAt: updatedAt, questionCount: 1, questions: [question], attempts: [attempt] });
    return { word, part, note, question, answer, attempt, test };
  }
  type Fixture = ReturnType<typeof fixture>;
  function childSetup() {
    const { sync, fetchMock } = setup();
    const f = fixture();
    vi.mocked(getAll).mockImplementation(async store => {
      if (store === "subjects") return [subject];
      if (store === "notes") return [f.note];
      if (store === "tests") return [f.test];
      return [];
    });
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/note" && init?.method === "POST") {
        return new Response(JSON.stringify([{ updated_at: updatedAt }]), { status: 200 });
      }
      if (path === "/note_part" && init?.method === "GET") {
        return new Response("[]", { status: 200 });
      }
      if (init?.method === "POST" || init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error("想定外の通信");
    });
    return { sync, fetchMock, f };
  }

  const invalid: [string, string, (f: Fixture) => void][] = [
    ["部品の別所有者", "所有者が一致しません（note_part）", f => { f.part.studentId = "other-student"; }],
    ["単語の別所有者", "所有者が一致しません（word）", f => { f.word.studentId = "other-student"; }],
    ["問題の別所有者", "所有者が一致しません（question）", f => { f.question.studentId = "other-student"; }],
    ["受験の別所有者", "所有者が一致しません（attempt）", f => { f.attempt.studentId = "other-student"; }],
    ["解答の別所有者", "所有者が一致しません（answer）", f => { f.answer.studentId = "other-student"; }],
    ["所有者の欠落", "所有者が一致しません（word）", f => { f.word.studentId = ""; }],
    ["部品の親不一致", "note_part → note", f => { f.part.noteId = "other-note"; }],
    ["単語の親不一致", "word → note_part", f => { f.word.partId = "other-part"; }],
    ["問題の親不一致", "question → test", f => { f.question.testId = "other-test"; }],
    ["受験の親不一致", "attempt → test", f => { f.attempt.testId = "other-test"; }],
    ["解答の親不一致", "answer → attempt", f => { f.answer.attemptId = "other-attempt"; }],
    ["解答の問題不一致", "answer → question", f => { f.answer.questionId = "other-question"; }],
  ];
  it.each(invalid)("%s の場合は全HTTP通信の前に中止する", async (_name, message, change) => {
    const { sync, fetchMock, f } = childSetup();
    // 先に送る削除ログがあっても、不正なデータの検出時は保持する。
    vi.mocked(getAllBy).mockResolvedValue([{ table: "subject", key: "deleted-subject", studentId, at: updatedAt }]);
    change(f);
    await expect(sync.pushChanges()).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });

  it("正常なノート・テストの子データは送信できる", async () => {
    const { sync, fetchMock } = childSetup();
    await sync.pushChanges();
    const writes = new Map(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [new URL(url).pathname, JSON.parse(String(init?.body))]));
    expect(writes.get("/note_part")).toEqual([expect.objectContaining({ part_id: "p1", student_id: studentId, note_id: "n1" })]);
    expect(writes.get("/word")).toEqual([expect.objectContaining({ word_id: "w1", student_id: studentId, part_id: "p1" })]);
    expect(writes.get("/question")).toEqual([expect.objectContaining({ question_id: "q1", student_id: studentId, test_id: "t1" })]);
    expect(writes.get("/attempt")).toEqual([expect.objectContaining({ attempt_id: "r1", student_id: studentId, test_id: "t1" })]);
    expect(writes.get("/answer")).toEqual([expect.objectContaining({ answer_id: "a1", student_id: studentId, attempt_id: "r1", question_id: "q1" })]);
    expect(meta.get(lastSyncKey)).not.toBe(previousSync);
  });

  it("テスト取得時に追加された削除ログを次の同期まで保持する", async () => {
    const { sync, fetchMock, f } = childSetup();
    let pending = false;
    vi.mocked(getAllBy).mockImplementation(async () => pending
      ? [{ table: "test", key: "t1", studentId, at: updatedAt }]
      : []);
    vi.mocked(getAll).mockImplementation(async store => {
      if (store === "subjects") return [subject];
      if (store === "notes") return [f.note];
      if (store === "tests") {
        if (pending) return [];
        // 読み込み結果は削除前の状態だが、読み込み直後に削除ログが作られる。
        pending = true;
        return [f.test];
      }
      return [];
    });
    const callsForTest = () => fetchMock.mock.calls
      .filter(([url]) => new URL(url).pathname === "/test")
      .map(([, init]) => init?.method);

    await sync.pushChanges();
    expect(callsForTest()).toEqual(["POST"]);
    expect(del).not.toHaveBeenCalled();

    // 次回は削除後の端末データを取得し、保留していた削除だけを送る。
    await sync.pushChanges();
    expect(callsForTest()).toEqual(["POST", "DELETE"]);
    expect(del).toHaveBeenCalledWith("deletions", ["test", "t1"]);
  });

  it("別アカウントのノート・テストは今回の送信対象にしない", async () => {
    const { sync, fetchMock, f } = childSetup();
    f.note.studentId = "other-student";
    f.test.studentId = "other-student";
    // 別アカウント側の子データは今回の検証・送信の対象外。
    await sync.pushChanges();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe("/subject");
    expect(meta.get(lastSyncKey)).not.toBe(previousSync);
  });
});
