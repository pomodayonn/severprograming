// 単体テスト：stepZoom・clampPane（ノートの大きさと、左右の欄の幅）
// 「−」「＋」で決まった段階に1段ずつ動くか、端で止まるか、「全体」で段階の間にいても近い段へ進むか。欄の幅が 180〜480px に収まるか
import { describe, expect, it } from "vitest";
import { clampPane, stepZoom } from "../../src/lib/logic";

describe("stepZoom：ノートの大きさを1段ずつ変える", () => {
  it("100% から＋で 110%", () => expect(stepZoom(1, 1)).toBe(1.1));
  it("100% から−で 90%", () => expect(stepZoom(1, -1)).toBe(0.9));
  it("いちばん大きい 150% より大きくならない", () => expect(stepZoom(1.5, 1)).toBe(1.5));
  it("いちばん小さい 50% より小さくならない", () => expect(stepZoom(0.5, -1)).toBe(0.5));
  it("「全体」で 76% のときは、＋で 80%、−で 70%", () => { expect(stepZoom(0.76, 1)).toBe(0.8); expect(stepZoom(0.76, -1)).toBe(0.7); });
});

describe("clampPane：左右の欄の幅", () => {
  it("180〜480px はそのまま（整数にする）", () => expect(clampPane(300.4)).toBe(300));
  it("細すぎれば 180px", () => expect(clampPane(20)).toBe(180));
  it("太すぎれば 480px", () => expect(clampPane(900)).toBe(480));
});
