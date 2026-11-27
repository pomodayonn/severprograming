// AI-04・TEST-04：記述テストの生成問題数の保証
// AI通信・認証・DBをモック化して検証する。

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  readEssay,
} from "../../server/src/service/AiPrompts.js";

import {
  AiService,
} from "../../server/src/boundary/AiService.js";

import {
  ApiController,
} from "../../server/src/controller/ApiController.js";

import {
  TestManager,
} from "../../src/managers/TestManager";

import type {
  TestDAO,
} from "../../src/dao/TestDAO";

import {
  Test,
} from "../../src/beans/Test";

import {
  SendContent,
} from "../../src/beans/SendContent";

import {
  makeEssay,
} from "../../src/services/ai";

vi.mock("../../src/services/ai", () => ({
  explain: vi.fn(),
  makeEssay: vi.fn(),
  regenerateQuestion: vi.fn(),
}));

const questions = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    q: `問題${i + 1}`,
    a: `模範解答${i + 1}`,
  }));

const reply = (count: number) =>
  JSON.stringify({
    questions: questions(count),
  });

describe("AI-04：バックエンドの生成問題数検証", () => {
  it("指定数の問題を正常に取得できる", () => {
    expect(readEssay(reply(5), 5))
      .toEqual(questions(5));
  });

  it("問題数が不足している場合は拒否する", () => {
    expect(() => readEssay(reply(3), 5))
      .toThrow("問題数が不足");
  });

  it("無効な問題を除いた結果が不足していれば拒否する", () => {
    const invalid = JSON.stringify({
      questions: [
        ...questions(4),
        { q: "問題5", a: " " },
      ],
    });

    expect(() => readEssay(invalid, 5))
      .toThrow("問題数が不足");
  });

  it("問題数が多い場合は指定数までにする", () => {
    expect(readEssay(reply(7), 5))
      .toEqual(questions(5));
  });

  it("問題数が不足した場合は次のAIを試す", async () => {
    const first = {
      name: "first",
      canAccept: () => true,
      send: vi.fn().mockResolvedValue(reply(3)),
    };

    const second = {
      name: "second",
      canAccept: () => true,
      send: vi.fn().mockResolvedValue(reply(5)),
    };

    const service = new AiService(
      [first, second],
      [{
        name: "test",
        maxChars: 100000,
        providers: ["first", "second"],
      }]
    );

    const result = await service.send(
      "問題を5問作ってください",
      r => readEssay(r, 5)
    );

    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();

    expect(result).toEqual(questions(5));
  });

  it("すべてのAIで問題数が不足した場合は予約を戻す", async () => {
    const provider = {
      name: "test-ai",
      canAccept: () => true,
      send: vi.fn().mockResolvedValue(reply(3)),
    };

    const service = new AiService(
      [provider],
      [{
        name: "test",
        maxChars: 100000,
        providers: ["test-ai"],
      }]
    );

    const usage = {
      reserve: vi.fn().mockResolvedValue({
        useDate: "2026-11-28",
        remaining: 19,
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const controller = new ApiController(
      {
        verify: vi.fn()
          .mockResolvedValue("student-1"),
      },
      usage,
      service
    );

    const res = {
      status: vi.fn(),
      json: vi.fn(),
    };

    res.status.mockReturnValue(res);

    await controller.makeEssayTest(
      {
        headers: {
          authorization: "Bearer mock-token",
        },
        body: {
          text: "テスト用の文章",
          count: 5,
        },
      },
      res
    );

    expect(usage.reserve)
      .toHaveBeenCalledWith("student-1", 1);

    expect(usage.release)
      .toHaveBeenCalledWith(
        "student-1",
        "2026-11-28",
        1
      );

    expect(res.status)
      .toHaveBeenCalledWith(503);

    expect(res.json)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "AI_UNAVAILABLE",
          }),
        })
      );
  });
});

function setupManager() {
  let stored: Test | null = null;

  const dao = {
    insert: vi.fn(async (test: Test) => {
      stored = test;
    }),

    findById: vi.fn(async () => stored),
  };

  const sync = {
    pushChanges: vi.fn()
      .mockResolvedValue(undefined),
  };

  const manager = new TestManager(
    dao as unknown as TestDAO,
    {
      getWords: vi.fn().mockResolvedValue([]),
    },
    sync
  );

  const create = () =>
    manager.createEssayTest(
      "item-1",
      "student-1",
      new SendContent({
        text: "テスト用の学習資料",
      }),
      5
    );

  return {
    dao,
    sync,
    create,
  };
}

describe("TEST-04：不完全な記述テストの保存防止", () => {
  it("問題数が不足した場合は保存も同期もしない", async () => {
    const { dao, sync, create } = setupManager();

    vi.mocked(makeEssay)
      .mockResolvedValue(questions(3));

    await expect(create())
      .rejects.toThrow("有効な問題を生成できません");

    expect(dao.insert).not.toHaveBeenCalled();
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });

  it("空の模範解答が含まれている場合は保存しない", async () => {
    const { dao, sync, create } = setupManager();

    vi.mocked(makeEssay).mockResolvedValue([
      ...questions(4),
      { q: "問題5", a: " " },
    ]);

    await expect(create())
      .rejects.toThrow("有効な問題を生成できません");

    expect(dao.insert).not.toHaveBeenCalled();
    expect(sync.pushChanges).not.toHaveBeenCalled();
  });

  it("指定された問題数を満たした場合は保存する", async () => {
    const { dao, sync, create } = setupManager();

    vi.mocked(makeEssay)
      .mockResolvedValue(questions(5));

    const result = await create();

    expect(result.questionCount).toBe(5);
    expect(result.questions).toHaveLength(5);

    expect(result.questions.map(q => q.number))
      .toEqual([1, 2, 3, 4, 5]);

    expect(dao.insert).toHaveBeenCalledOnce();
    expect(sync.pushChanges).toHaveBeenCalledOnce();
  });
});