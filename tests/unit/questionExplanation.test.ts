// 単体テスト：問題変更時の古い解説の初期化
// TEST-03 の回帰テスト。
// 実際の IndexedDB や AI サーバーには接続しない。

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TestDAO } from "../../src/dao/TestDAO";
import { TestManager } from "../../src/managers/TestManager";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { TestType } from "../../src/enums/TestType";

import {
  get,
  put,
  editStoredTest,
} from "../../src/dao/idb";

import {
  regenerateQuestion as aiRegenerate,
} from "../../src/services/ai";

vi.mock("../../src/dao/idb", () => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  getAllBy: vi.fn(),
  recordDeletion: vi.fn(),
  editStoredTest: vi.fn(),
}));

vi.mock("../../src/services/ai", () => ({
  explain: vi.fn(),
  makeEssay: vi.fn(),
  regenerateQuestion: vi.fn(),
}));

const studentId = "student-1";
const testId = "test-1";
const questionId = "question-1";

const oldQuestion = "HTTPとは何ですか";
const oldAnswer = "通信プロトコルです";
const oldExplanation = "HTTPについての以前の解説";

const otherQuestion = new Question({
  questionId: "question-2",
  studentId,
  testId,
  number: 2,
  questionText: "HTMLとは何ですか",
  modelAnswer: "マークアップ言語です",
  explanation: "HTMLについての解説",
});

let stored: Test;

beforeEach(() => {
  vi.resetAllMocks();

  stored = new Test({
    testId,
    studentId,
    itemId: "item-1",
    testType: TestType.ESSAY,
    questionCount: 2,
    questions: [
      new Question({
        questionId,
        studentId,
        testId,
        number: 1,
        questionText: oldQuestion,
        modelAnswer: oldAnswer,
        explanation: oldExplanation,
        updatedAt: "2026-11-25T00:00:00.000Z",
      }),
      structuredClone(otherQuestion),
    ],
    attempts: [],
  });

  // IndexedDBからの読み込みを再現する。
  vi.mocked(get).mockImplementation(
    async (store, key) => {
      if (store === "tests" && key === testId) {
        return structuredClone(stored);
      }

      return undefined;
    }
  );

  // IndexedDBへの保存を再現する。
  vi.mocked(put).mockImplementation(
    async (store, value) => {
      if (store === "tests") {
        stored = structuredClone(value as Test);
      }
    }
  );

    // テスト更新用トランザクションのモック
  vi.mocked(editStoredTest).mockImplementation(
    async (id, edit) => {
      const row = await get<Test>("tests", id);

      if (!row) {
        throw new Error("テストが見つかりません");
      }

      const updated = edit(row);

      await put("tests", updated.test);

      return updated.result;
    }
  );
});

function setup() {
  const dao = new TestDAO();

  const noteManager = {
    getWords: vi.fn().mockResolvedValue([]),
  };

  const syncManager = {
    pushChanges: vi.fn().mockResolvedValue(undefined),
  };

  const manager = new TestManager(
    dao,
    noteManager,
    syncManager
  );

  return {
    dao,
    manager,
    syncManager,
  };
}

describe("TEST-03：問題変更時の解説の初期化", () => {
  it("問題文を変更すると古い解説を初期化する", async () => {
    const { manager } = setup();

    await manager.editQuestion(
      testId,
      questionId,
      "HTTPSとは何ですか",
      oldAnswer
    );

    expect(stored.questions[0].questionText)
      .toBe("HTTPSとは何ですか");

    expect(stored.questions[0].explanation)
      .toBeNull();
  });

  it("模範解答を変更すると古い解説を初期化する", async () => {
    const { manager } = setup();

    await manager.editQuestion(
      testId,
      questionId,
      oldQuestion,
      "Webで利用する通信プロトコルです"
    );

    expect(stored.questions[0].modelAnswer)
      .toBe("Webで利用する通信プロトコルです");

    expect(stored.questions[0].explanation)
      .toBeNull();
  });

  it("問題文と模範解答が同じなら解説を保持する", async () => {
    const { manager } = setup();

    await manager.editQuestion(
      testId,
      questionId,
      oldQuestion,
      oldAnswer
    );

    expect(stored.questions[0].explanation)
      .toBe(oldExplanation);
  });

  it("他の問題の内容や解説を変更しない", async () => {
    const { manager } = setup();

    await manager.editQuestion(
      testId,
      questionId,
      "新しい問題",
      "新しい解答"
    );

    expect(stored.questions[1])
      .toEqual(otherQuestion);

    expect(stored.questions).toHaveLength(2);
  });

  it("AIによる問題再生成時に古い解説を初期化する", async () => {
    const { manager, syncManager } = setup();

    vi.mocked(aiRegenerate).mockResolvedValue({
      q: "HTTPSの特徴を説明してください",
      a: "通信を暗号化します",
    });

    await manager.regenerateQuestion(
      testId,
      questionId,
      ""
    );

    expect(stored.questions[0]).toMatchObject({
      questionId,
      questionText: "HTTPSの特徴を説明してください",
      modelAnswer: "通信を暗号化します",
      explanation: null,
    });

    expect(put).toHaveBeenCalledOnce();

    expect(syncManager.pushChanges)
      .toHaveBeenCalledOnce();
  });

  it("AI通信に失敗した場合は既存データを保持する", async () => {
    const { manager, syncManager } = setup();

    const original = structuredClone(stored);

    vi.mocked(aiRegenerate).mockRejectedValue(
      new Error("通信失敗")
    );

    await expect(
      manager.regenerateQuestion(
        testId,
        questionId,
        ""
      )
    ).rejects.toThrow("通信失敗");

    expect(stored).toEqual(original);

    expect(put).not.toHaveBeenCalled();

    expect(syncManager.pushChanges)
      .not.toHaveBeenCalled();
  });

  it("空の問題や模範解答が返された場合は保存しない", async () => {
    const { manager, syncManager } = setup();

    const original = structuredClone(stored);

    for (const response of [
      { q: "", a: "解答" },
      { q: "問題", a: "" },
      { q: "   ", a: "解答" },
      { q: "問題", a: "   " },
    ]) {
      vi.mocked(aiRegenerate)
        .mockResolvedValueOnce(response);

      await expect(
        manager.regenerateQuestion(
          testId,
          questionId,
          ""
        )
      ).rejects.toThrow(
        "有効な問題を生成できませんでした"
      );
    }

    expect(stored).toEqual(original);

    expect(put).not.toHaveBeenCalled();

    expect(syncManager.pushChanges)
      .not.toHaveBeenCalled();
  });

  it("AI再生成の戻り値が実際の保存内容と一致する", async () => {
    const { manager } = setup();

    vi.mocked(aiRegenerate).mockResolvedValue({
      q: "新しい問題",
      a: "新しい模範解答",
    });

    const result =
      await manager.regenerateQuestion(
        testId,
        questionId,
        ""
      );

    expect(result)
      .toEqual(stored.questions[0]);

    expect(result.explanation)
      .toBeNull();

    expect(result.updatedAt)
      .not.toBe("2026-11-25T00:00:00.000Z");
  });
});