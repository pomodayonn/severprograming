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
import { LearningItem } from "../../src/beans/LearningItem";
import { Prerequisite } from "../../src/beans/Prerequisite";
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
  acknowledgeDeletion,
  type Deletion,
} from "../../src/dao/idb";

vi.mock("../../src/dao/idb", () => ({
  get: vi.fn(),
  getAll: vi.fn(),
  getAllBy: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  replaceStudentData: vi.fn(),
  acknowledgeDeletion: vi.fn(),
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
  vi.mocked(acknowledgeDeletion).mockResolvedValue(true);

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
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
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
      if (store === "learningItems") return [new LearningItem({ itemId: "i1", studentId, subjectId: subject.subjectId, updatedAt: previousSync })];
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
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
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
      if (store === "learningItems") return [new LearningItem({ itemId: "i1", studentId, subjectId: subject.subjectId, updatedAt: previousSync })];
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
    expect(acknowledgeDeletion).not.toHaveBeenCalled();

    // 次回は削除後の端末データを取得し、保留していた削除だけを送る。
    await sync.pushChanges();
    expect(callsForTest()).toEqual(["POST", "DELETE"]);
    expect(acknowledgeDeletion).toHaveBeenCalledWith({ table: "test", key: "t1", studentId, at: updatedAt });
    expect(del).not.toHaveBeenCalled();
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

// SYNC-14b: 端末内の合成データを検証する。実DB・外部サービスは使用しない。
describe("SYNC-14b：送信前のルート参照検証", () => {
  function rootSetup() {
    const { sync, fetchMock } = setup();
    const parent = new Subject({ ...subject, updatedAt: previousSync });
    const other = new Subject({ subjectId: "s2", studentId, updatedAt: previousSync });
    const item = new LearningItem({ itemId: "i1", studentId, subjectId: parent.subjectId, updatedAt: previousSync });
    const prior = new LearningItem({ itemId: "i2", studentId, subjectId: parent.subjectId, updatedAt: previousSync });
    const link = new Prerequisite({ itemId: "i1", prereqItemId: "i2", studentId, updatedAt });
    const note = new Note({ noteId: "n1", itemId: "i1", studentId, updatedAt, lastSavedAt: updatedAt });
    const test = new Test({ testId: "t1", itemId: "i1", studentId, updatedAt, createdAt: updatedAt, questions: [new Question({ questionId: "q1", testId: "t1", studentId, number: 1 })] });
    const f = { parent, other, item, prior, link, note, test };
    vi.mocked(getAll).mockImplementation(async store => {
      if (store === "subjects") return [parent, other];
      if (store === "learningItems") return [item, prior];
      if (store === "prerequisites") return [link];
      if (store === "notes") return [note];
      if (store === "tests") return [test];
      return [];
    });
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === "/note" && init?.method === "POST") return new Response(JSON.stringify([{ updated_at: updatedAt }]), { status: 200 });
      if (init?.method === "POST" || init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error("想定外の通信");
    });
    return { sync, fetchMock, f };
  }
  type Roots = ReturnType<typeof rootSetup>["f"];
  const invalid: [string, string, (f: Roots) => void][] = [
    ["変更項目の科目欠落", "learning_item → subject", f => { f.item.updatedAt = updatedAt; f.item.subjectId = "missing"; }],
    ["変更項目の科目が別所有者", "learning_item → subject", f => { f.item.updatedAt = updatedAt; f.parent.studentId = "other-student"; }],
    ["ノートの親欠落", "note → learning_item", f => { f.note.itemId = "missing"; }],
    ["ノートの親が別所有者", "note → learning_item", f => { f.link.updatedAt = previousSync; f.item.studentId = "other-student"; }],
    ["未変更の親項目の科目欠落", "learning_item → subject", f => { f.item.subjectId = "missing"; }],
    ["テストの親欠落", "test → learning_item", f => { f.test.itemId = "missing"; }],
    ["テストの親が別所有者", "test → learning_item", f => { f.prior.studentId = "other-student"; f.link.updatedAt = previousSync; f.test.itemId = "i2"; }],
    ["前提関係の始点欠落", "prerequisite → item_id", f => { f.link.itemId = "missing"; }],
    ["前提関係の終点欠落", "prerequisite → prereq_item_id", f => { f.link.prereqItemId = "missing"; }],
    ["前提関係の終点が別所有者", "prerequisite → prereq_item_id", f => { f.prior.studentId = "other-student"; }],
    ["前提関係の自己参照", "prerequisite の自己参照", f => { f.link.prereqItemId = "i1"; }],
    ["前提関係の科目不一致", "prerequisite の科目不一致", f => { f.prior.subjectId = "s2"; }],
    ["空のノート親ID", "note → learning_item", f => { f.note.itemId = " "; }],
  ];
  it.each(invalid)("%s なら削除を含むHTTP通信前に中止する", async (_name, message, change) => {
    const { sync, fetchMock, f } = rootSetup();
    vi.mocked(getAllBy).mockResolvedValue([{ table: "subject", key: "deleted-subject", studentId, at: updatedAt }]);
    change(f);
    await expect(sync.pushChanges()).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
  it("同期済みの親を検証に使い、再送せずに子だけ送る", async () => {
    const { sync, fetchMock } = rootSetup();
    await sync.pushChanges();
    const paths = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => new URL(url).pathname);
    expect(paths).toEqual(["/prerequisite", "/note", "/test", "/question"]);
    expect(meta.get(lastSyncKey)).not.toBe(previousSync);
  });
  it("変更された親と子を順に送信する", async () => {
    const { sync, fetchMock, f } = rootSetup();
    f.parent.updatedAt = updatedAt;
    f.item.updatedAt = updatedAt;
    await sync.pushChanges();
    const paths = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => new URL(url).pathname);
    expect(paths).toEqual(["/subject", "/learning_item", "/prerequisite", "/note", "/test", "/question"]);
    expect(meta.get(lastSyncKey)).not.toBe(previousSync);
  });
});

// SYNC-14c: 削除ログはすべて合成データ。fetchもIndexedDBもモック。
describe("SYNC-14c：削除ログの事前検証", () => {
  const valid = (): Deletion => ({ table: "subject", key: "deleted-subject", studentId, at: previousSync });
  const malformed: [string, string, unknown][] = [
    ["null", "形式", null],
    ["別の所有者", "所有者", { ...valid(), studentId: "other-student" }],
    ["所有者が空", "所有者", { ...valid(), studentId: "" }],
    ["テーブル名が数値", "テーブル名", { ...valid(), table: 123 }],
    ["許可されていないテーブル", "テーブル名", { ...valid(), table: "ai_usage" }],
    ["継承プロパティ", "テーブル名", { ...valid(), table: "__proto__" }],
    ["constructor", "テーブル名", { ...valid(), table: "constructor" }],
    ["パスを含むテーブル名", "テーブル名", { ...valid(), table: "subject/other" }],
    ["空キー", "主キー", { ...valid(), key: "" }],
    ["空白キー", "主キー", { ...valid(), key: " " }],
    ["数値キー", "主キー", { ...valid(), key: 123 }],
    ["フィルタ記号を含むキー", "主キー", { ...valid(), key: "x&y" }],
    ["改行を含むキー", "主キー", { ...valid(), key: "id\n" }],
    ["複合キーの区切り欠落", "複合キー", { ...valid(), table: "prerequisite", key: "i1" }],
    ["複合キーの始点欠落", "複合キー", { ...valid(), table: "prerequisite", key: "|i2" }],
    ["複合キーの終点欠落", "複合キー", { ...valid(), table: "prerequisite", key: "i1|" }],
    ["複合キーの要素過多", "複合キー", { ...valid(), table: "prerequisite", key: "i1|i2|i3" }],
    ["複合キーの不正文字", "複合キー", { ...valid(), table: "prerequisite", key: "i1|i 2" }],
    ["削除日時が数値", "削除日時", { ...valid(), at: 123 }],
    ["削除日時が不正", "削除日時", { ...valid(), at: "invalid" }],
    ["削除日時が非正規形式", "削除日時", { ...valid(), at: "2026-11-25" }],
    ["削除ログの版が不正", "削除ログの版", { ...valid(), revision: "invalid" }],
  ];
  it.each(malformed)("%s が後続ログにあっても全通信を止める", async (_name, message, bad) => {
    const { sync, fetchMock } = setup();
    // IndexedDBの型宣言と実際の値が一致しないケースを意図的に再現。
    vi.mocked(getAllBy).mockResolvedValue([valid(), bad] as Deletion[]);
    await expect(sync.pushChanges()).rejects.toThrow(`削除ログの整合性を確認できません（${message}）`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
  it("重複した削除ログも通信前に拒否する", async () => {
    const { sync, fetchMock } = setup();
    vi.mocked(getAllBy).mockResolvedValue([valid(), { ...valid(), at: updatedAt }]);
    await expect(sync.pushChanges()).rejects.toThrow("重複");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
  it("許可された5テーブルの削除を日時順・完全なキーで送る", async () => {
    const { sync, fetchMock } = setup();
    vi.mocked(getAll).mockResolvedValue([]);
    const logs: Deletion[] = [
      { ...valid(), table: "test", key: "t_1", at: "2026-11-25T00:00:05.000Z" },
      { ...valid(), table: "note", key: "n-1", at: "2026-11-25T00:00:04.000Z" },
      { ...valid(), table: "prerequisite", key: "i1|i2", at: "2026-11-25T00:00:03.000Z" },
      { ...valid(), table: "learning_item", key: "i1", at: "2026-11-25T00:00:02.000Z" },
      { ...valid(), at: "2026-11-25T00:00:01.000Z" },
    ];
    vi.mocked(getAllBy).mockResolvedValue(logs);
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== "DELETE") throw new Error("想定外の通信");
      return new Response(null, { status: 204 });
    });
    await sync.pushChanges();
    expect(fetchMock.mock.calls.map(([url, init]) => [init?.method, new URL(url).pathname + new URL(url).search])).toEqual([
      ["DELETE", "/subject?subject_id=eq.deleted-subject"],
      ["DELETE", "/learning_item?item_id=eq.i1"],
      ["DELETE", "/prerequisite?item_id=eq.i1&prereq_item_id=eq.i2"],
      ["DELETE", "/note?note_id=eq.n-1"],
      ["DELETE", "/test?test_id=eq.t_1"],
    ]);
    expect(vi.mocked(acknowledgeDeletion).mock.calls).toEqual([...logs].reverse().map(d => [d]));
    expect(del).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).not.toBe(previousSync);
  });
  it("正常な削除ログでもHTTP失敗時は保持して後続送信を止める", async () => {
    const { sync, fetchMock } = setup();
    vi.mocked(getAllBy).mockResolvedValue([valid(), { ...valid(), table: "test", key: "t2", at: updatedAt }]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(sync.pushChanges()).rejects.toBeInstanceOf(SyncError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(del).not.toHaveBeenCalled();
    expect(acknowledgeDeletion).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
});

// SYNC-07a: DELETE成功後のローカル消費が競合した場合は後続通信を止める。
describe("SYNC-07a：削除ログの消費競合", () => {
  it.each(["changed", "error"] as const)("消費結果が%sなら後続送信・同期日時更新を止める", async mode => {
    const { sync, fetchMock } = setup();
    const first: Deletion = { table: "test", key: "t1", studentId, at: previousSync, revision: "a".repeat(32) };
    const next: Deletion = { table: "test", key: "t2", studentId, at: updatedAt, revision: "b".repeat(32) };
    vi.mocked(getAllBy).mockResolvedValue([first, next]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    if (mode === "changed") vi.mocked(acknowledgeDeletion).mockResolvedValueOnce(false);
    else vi.mocked(acknowledgeDeletion).mockRejectedValueOnce(new Error("保存失敗"));
    await expect(sync.pushChanges()).rejects.toThrow(mode === "changed" ? "削除ログが変更" : "保存失敗");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(acknowledgeDeletion).toHaveBeenCalledOnce();
    expect(acknowledgeDeletion).toHaveBeenCalledWith(first);
    expect(del).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
  it("削除ログの競合時は最新化の受信・置換も開始しない", async () => {
    const { sync, fetchMock } = setup();
    const sent: Deletion = { table: "test", key: "t1", studentId, at: previousSync, revision: "a".repeat(32) };
    vi.mocked(getAllBy).mockResolvedValue([sent]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.mocked(acknowledgeDeletion).mockResolvedValueOnce(false);
    await expect(sync.pullAll()).rejects.toThrow("削除ログが変更");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(replaceStudentData).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(meta.get(lastSyncKey)).toBe(previousSync);
  });
});
