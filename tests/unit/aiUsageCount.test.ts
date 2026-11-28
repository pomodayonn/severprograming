// AI-01・02・03：AI利用回数と文章分割の回帰テスト
// 実際のAIサービスやNeonには接続しない。

import { describe, expect, it, vi } from "vitest";

import {
  calls,
  lengthOf,
  splitAiText,
  SEND_LIMIT,
} from "../../src/lib/logic";

import {
  countCalls,
  splitText,
  lengthOf as serverLengthOf,
} from "../../server/src/service/AiPrompts.js";

import {
  ApiController,
} from "../../server/src/controller/ApiController.js";

// 2万文字だが、改行位置によって3分割になる文章。
const longText =
  "あ".repeat(9000) +
  "\n" +
  "い".repeat(10999);

function setup() {
  const tokenVerifier = {
    verify: vi.fn().mockResolvedValue("student-1"),
  };

  const usage = {
    getRemaining: vi.fn().mockResolvedValue(20),
    reserve: vi.fn().mockResolvedValue({
      useDate: "2026-11-27",
      remaining: 17,
    }),
    release: vi.fn().mockResolvedValue(undefined),
  };

  const ai = {
    send: vi.fn(
      async (_prompt, check) => check(JSON.stringify({
        proposals: [
          { ft: "summary", text: "要約結果" },
        ],
        questions: [
          { q: "問題文", a: "模範解答" },
        ],
      }))
    ),
  };

  const controller = new ApiController(
    tokenVerifier,
    usage,
    ai
  );

  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };

  res.status.mockReturnValue(res);

  const request = (body: object) => ({
    headers: {
      authorization: "Bearer mock-token",
    },
    body,
  });

  return {
    controller,
    usage,
    ai,
    res,
    request,
  };
}

describe("AI-01・02：文章分割と文字数", () => {
  it("絵文字1万個を1万文字として数える", () => {
    const text = "😀".repeat(SEND_LIMIT);

    expect(lengthOf(text)).toBe(SEND_LIMIT);
    expect(serverLengthOf(text)).toBe(SEND_LIMIT);

    expect(calls(text)).toBe(1);
    expect(countCalls(text)).toBe(1);
  });

  it("改行で分割数が増える場合も必要回数を正しく計算する", () => {
    expect(lengthOf(longText)).toBe(20000);

    const chunks = splitAiText(longText);

    expect(chunks.map(lengthOf))
      .toEqual([9001, 10000, 999]);

    expect(chunks.join("")).toBe(longText);

    expect(splitText(longText)).toEqual(chunks);

    expect(calls(longText)).toBe(3);
    expect(countCalls(longText)).toBe(3);

    // その他の境界値でも両者の分割結果が一致する。
    for (const text of [
      "",
      "あ".repeat(9999),
      "あ".repeat(10000),
      "あ".repeat(10001),
      "😀".repeat(10001),
    ]) {
      expect(splitAiText(text))
        .toEqual(splitText(text));

      expect(calls(text))
        .toBe(countCalls(text));
    }
  });
});

describe("AI-01・03：APIの利用回数管理", () => {
  it("ノートまとめでは実際の分割数を予約する", async () => {
    const {
      controller, usage, ai, res, request,
    } = setup();

    await controller.organize(
      request({
        text: longText,
        frameTypes: ["summary"],
        frames: [],
      }),
      res
    );

    expect(usage.reserve)
      .toHaveBeenCalledWith("student-1", 3);

    expect(ai.send).toHaveBeenCalledTimes(3);

    expect(usage.release)
      .not.toHaveBeenCalled();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        remaining: 17,
        limit: 20,
      })
    );
  });

  it("利用回数が不足している場合はAIを呼ばない", async () => {
    const {
      controller, usage, ai, res, request,
    } = setup();

    usage.reserve.mockResolvedValue(null);

    await controller.organize(
      request({
        text: longText,
        frameTypes: ["summary"],
        frames: [],
      }),
      res
    );

    expect(usage.reserve)
      .toHaveBeenCalledWith("student-1", 3);

    expect(ai.send).not.toHaveBeenCalled();

    expect(res.status).toHaveBeenCalledWith(429);

    expect(usage.release)
      .not.toHaveBeenCalled();
  });

  it("文章分割数より問題数が少なければ予約前に拒否する", async () => {
    const {
      controller, usage, ai, res, request,
    } = setup();

    await controller.makeEssayTest(
      request({
        text: longText,
        count: 2,
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);

    expect(usage.reserve)
      .not.toHaveBeenCalled();

    expect(ai.send)
      .not.toHaveBeenCalled();
  });

  it("記述テストでは予約した分だけ文章をAIに送る", async () => {
    const {
      controller, usage, ai, res, request,
    } = setup();

    await controller.makeEssayTest(
      request({
        text: longText,
        count: 3,
      }),
      res
    );

    expect(usage.reserve)
      .toHaveBeenCalledWith("student-1", 3);

    expect(ai.send).toHaveBeenCalledTimes(3);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          { q: "問題文", a: "模範解答" },
          { q: "問題文", a: "模範解答" },
          { q: "問題文", a: "模範解答" },
        ],
        remaining: 17,
      })
    );
  });

  it("AI処理に失敗した場合は予約した回数を戻す", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const {
        controller, usage, ai, res, request,
      } = setup();

      ai.send.mockRejectedValueOnce(
        new Error("AI通信失敗")
      );

      await controller.makeEssayTest(
        request({
          text: longText,
          count: 3,
        }),
        res
      );

      expect(usage.reserve)
        .toHaveBeenCalledWith("student-1", 3);

      expect(usage.release)
        .toHaveBeenCalledWith(
          "student-1",
          "2026-11-27",
          3
        );

      expect(res.status).toHaveBeenCalledWith(500);

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "[API] 思いがけないエラー:",
        expect.objectContaining({ message: "AI通信失敗" })
      );
    } finally {
      errorLog.mockRestore();
    }
  });
});
