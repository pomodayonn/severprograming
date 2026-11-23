// 単体テスト：nodeLabel（関連図の丸の中に書く名前）
// 丸からはみ出さないように、4文字ずつ2行までにして、入らない分は「…」にする
import { describe, expect, it } from "vitest";
import { nodeLabel } from "../../src/lib/logic";

describe("nodeLabel：関連図の丸の中の名前", () => {
  it("4文字までは1行のまま", () => expect(nodeLabel("光合成")).toEqual(["光合成"]));
  it("ちょうど4文字も1行", () => expect(nodeLabel("細胞分裂")).toEqual(["細胞分裂"]));
  it("5〜8文字は2行に分ける", () => expect(nodeLabel("植物のつくり")).toEqual(["植物のつ", "くり"]));
  it("ちょうど8文字は「…」を付けない", () => expect(nodeLabel("一二三四五六七八")).toEqual(["一二三四", "五六七八"]));
  it("9文字以上は2行目を3文字と「…」にする", () => expect(nodeLabel("一二三四五六七八九")).toEqual(["一二三四", "五六七…"]));
  it("絵文字も1文字として数える（途中で切れない）", () => expect(nodeLabel("🌱🌱🌱🌱🌱")).toEqual(["🌱🌱🌱🌱", "🌱"]));
});
