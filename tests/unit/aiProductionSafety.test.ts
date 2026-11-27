// AI-05・07：本番環境での仮AI動作防止とエラー通知

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// 実際のNeon Authには接続しない。
vi.mock("../../src/boundary/NeonAuthClient", () => ({
  neonAuthClient: {
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function setup(
  production: boolean,
  apiUrl = ""
) {
  vi.resetModules();

  vi.stubEnv("DEV", !production);
  vi.stubEnv("PROD", production);
  vi.stubEnv("VITE_API_URL", apiUrl);

  return import("../../src/services/ai");
}

describe("AI-07：本番環境での仮AI動作防止", () => {
  it("本番環境でAPI未設定ならノートまとめを拒否する", async () => {
    const ai = await setup(true);

    await expect(
      ai.organize(
        "テスト用文章",
        ["summary"],
        []
      )
    ).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  });

  it("本番環境でAPI未設定なら記述テスト生成を拒否する", async () => {
    const ai = await setup(true);

    await expect(
      ai.makeEssay("テスト用文章", 5)
    ).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  });

  it("本番環境でAPI未設定なら解説生成を拒否する", async () => {
    const ai = await setup(true);

    await expect(
      ai.explain({
        q: "問題",
        a: "模範解答",
      })
    ).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  });

  it("本番環境でAPI未設定なら問題再生成を拒否する", async () => {
    const ai = await setup(true);

    await expect(
      ai.regenerateQuestion({
        q: "問題",
        a: "模範解答",
      })
    ).rejects.toMatchObject({
      code: "CONFIGURATION",
    });
  });

  it("開発環境ではAPI未設定時も仮AIを利用できる", async () => {
    const ai = await setup(false);

    const result = await ai.explain({
      q: "問題",
      a: "模範解答",
    });

    expect(result).toContain("模範解答");
  });

  it("本番環境でAPI設定済みならサーバーを利用する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          explanation: "サーバーの解説",
          remaining: 19,
          limit: 20,
        }),
        { status: 200 }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const ai = await setup(
      true,
      "https://example.invalid"
    );

    const result = await ai.explain({
      q: "問題",
      a: "模範解答",
    });

    expect(result).toBe("サーバーの解説");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.invalid/api/explain",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("本番環境でAPI未設定なら端末の利用回数を更新しない", async () => {
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
    };

    vi.stubGlobal("localStorage", storage);

    const ai = await setup(true);

    ai.addLocalUsage(1);

    expect(storage.setItem)
      .not.toHaveBeenCalled();
  });
});

describe("AI-05：タイムアウト時のエラー通知", () => {
  it("利用回数が減っていないと断言しない", async () => {
    const { ApiError } = await import(
      "../../src/services/api"
    );

    const error = new ApiError("TIMEOUT");

    expect(error.message)
      .not.toContain("利用回数は減っていません");

    expect(error.message)
      .toContain("残りの利用回数を確認");

    expect(error.message)
      .toContain("処理が続いている可能性");
  });
});