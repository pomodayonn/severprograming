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
describe("SYNC-13：受信データの親子関係検証", () => {
  function graphSetup() {
    const { sync, fetchMock } =
      setup(true, false);

    // 正常な親子関係を持つ合成データ。
    const data: Record<
      string,
      Record<string, unknown>[]
    > = {
      subject: [
        { subject_id: "s1" },
      ],

      learning_item: [
        {
          item_id: "i1",
          subject_id: "s1",
        },
        {
          item_id: "i2",
          subject_id: "s1",
        },
      ],

      prerequisite: [
        {
          item_id: "i1",
          prereq_item_id: "i2",
        },
      ],

      note: [
        {
          note_id: "n1",
          item_id: "i1",
        },
      ],

      note_part: [
        {
          part_id: "p1",
          note_id: "n1",
          part_type: "TEXT",
          text: "テスト",
          width: 100,
          height: 50,
        },
      ],

      word: [
        {
          word_id: "w1",
          part_id: "p1",
          term: "test",
          meaning: "試験",
        },
      ],

      test: [
        {
          test_id: "t1",
          item_id: "i1",
          question_count: 1,
        },
      ],

      question: [
        {
          question_id: "q1",
          test_id: "t1",
          number: 1,
        },
      ],

      attempt: [
        {
          attempt_id: "r1",
          test_id: "t1",
          attempt_no: 1,
        },
      ],

      answer: [
        {
          answer_id: "a1",
          attempt_id: "r1",
          question_id: "q1",
        },
      ],
    };

    fetchMock.mockImplementation(
      async url => {
        const table =
          new URL(url).pathname.slice(1);

        const rows = data[table];

        if (!rows) {
          throw new Error(
            `想定外のテーブル：${table}`
          );
        }

        return new Response(
          JSON.stringify(
            rows.map(row => ({
              ...row,
              student_id: studentId,
            }))
          ),
          { status: 200 }
        );
      }
    );

    return { sync, data };
  }

  it("正常な親子関係では端末データを置換できる", async () => {
    const { sync } = graphSetup();

    await sync.pullAll();

    expect(replaceStudentData)
      .toHaveBeenCalledOnce();
  });

  it.each([
    [
      "learning_item",
      "subject_id",
      "learning_item → subject",
    ],
    [
      "prerequisite",
      "item_id",
      "prerequisite → learning_item",
    ],
    [
      "prerequisite",
      "prereq_item_id",
      "prerequisite → prerequisite_item",
    ],
    [
      "note",
      "item_id",
      "note → learning_item",
    ],
    [
      "note_part",
      "note_id",
      "note_part → note",
    ],
    [
      "word",
      "part_id",
      "word → note_part",
    ],
    [
      "test",
      "item_id",
      "test → learning_item",
    ],
    [
      "question",
      "test_id",
      "question → test",
    ],
    [
      "attempt",
      "test_id",
      "attempt → test",
    ],
    [
      "answer",
      "attempt_id",
      "answer → attempt",
    ],
    [
      "answer",
      "question_id",
      "answer → question",
    ],
  ])(
    "%s.%s の参照先が存在しなければ最新化しない",
    async (table, key, relation) => {
      const { sync, data } = graphSetup();

      // 存在しない親IDを設定する。
      data[table][0][key] = "missing-parent";

      await expect(sync.pullAll())
        .rejects.toThrow(relation);

      expect(replaceStudentData)
        .not.toHaveBeenCalled();

      expect(put).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    }
  );

  it("主キーが重複していれば最新化しない", async () => {
    const { sync, data } = graphSetup();

    data.subject.push({
      subject_id: "s1",
    });

    await expect(sync.pullAll())
      .rejects.toThrow("subject.subject_id の重複");

    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("主キーが欠落していれば最新化しない", async () => {
    const { sync, data } = graphSetup();

    delete data.subject[0].subject_id;

    await expect(sync.pullAll())
      .rejects.toThrow("subject.subject_id の欠落");

    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it.each([
    ["自己参照", "prerequisite の自己参照"],
    ["科目不一致", "prerequisite の科目不一致"],
    ["複合主キー重複", "prerequisite の複合主キー重複"],
    ["テスト不一致", "answer のテスト不一致"],
  ])("%s の受信を拒否し端末データを保持する", async (kind, message) => {
    const { sync, data } = graphSetup();
    if (kind === "自己参照") {
      data.prerequisite[0].prereq_item_id = "i1";
    } else if (kind === "科目不一致") {
      data.subject.push({ subject_id: "s2" });
      data.learning_item[1].subject_id = "s2";
    } else if (kind === "複合主キー重複") {
      data.prerequisite.push({ ...data.prerequisite[0] });
    } else {
      // 親が存在し、各テストの問題数も一致するが、解答だけが別テストを参照する。
      data.test.push({ test_id: "t2", item_id: "i2", question_count: 1 });
      data.question.push({ question_id: "q2", test_id: "t2", number: 1 });
      data.answer[0].question_id = "q2";
    }
    await expect(sync.pullAll()).rejects.toThrow(message);
    expect(replaceStudentData).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("同じ科目の異なる前提リンクと別テスト内の正常な解答を受信できる", async () => {
    const { sync, data } = graphSetup();
    data.learning_item.push({ item_id: "i3", subject_id: "s1" });
    data.prerequisite.push({ item_id: "i1", prereq_item_id: "i3" });
    data.test.push({ test_id: "t2", item_id: "i2", question_count: 1 });
    data.question.push({ question_id: "q2", test_id: "t2", number: 1 });
    data.attempt.push({ attempt_id: "r2", test_id: "t2", attempt_no: 1 });
    data.answer.push({ answer_id: "a2", attempt_id: "r2", question_id: "q2" });
    await sync.pullAll();
    expect(replaceStudentData).toHaveBeenCalledOnce();
  });

  it("問題数が不足していれば最新化しない", async () => {
    const { sync, data } = graphSetup();

    data.test[0].question_count = 2;

    await expect(sync.pullAll())
      .rejects.toThrow(
        "test.question_count の不一致"
      );

    expect(replaceStudentData)
      .not.toHaveBeenCalled();

    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
