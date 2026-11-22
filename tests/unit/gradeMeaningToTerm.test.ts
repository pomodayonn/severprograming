// 単体テスト：TestManager.gradeMeaningToTerm（単語テスト「意味→用語」の採点）
// 全角半角・大文字小文字・前後の空白は区別せず、全体が同じときだけ正解（要件定義書の決めごと）
// gradeMeaningToTerm は private なので、テストの中だけ型を外して呼ぶ
import { describe, expect, it } from "vitest";
import { TestManager } from "../../src/managers/TestManager";

type Grader = { gradeMeaningToTerm(input: string, modelAnswer: string): boolean };
const manager = Object.create(TestManager.prototype) as Grader; // DAO はいらないので、コンストラクタは通さない
const grade = (input: string, model: string) => manager.gradeMeaningToTerm(input, model);

describe("gradeMeaningToTerm：正解にする", () => {
  it("まったく同じ", () => expect(grade("葉緑体", "葉緑体")).toBe(true));
  it("前後の空白は無視", () => expect(grade("  葉緑体 　", "葉緑体")).toBe(true));
  it("大文字と小文字は区別しない", () => expect(grade("dna", "DNA")).toBe(true));
  it("全角と半角の英数字は区別しない", () => expect(grade("ＤＮＡ", "DNA")).toBe(true));
  it("半角カタカナと全角カタカナは区別しない", () => expect(grade("ｺｳｺﾞｳｾｲ", "コウゴウセイ")).toBe(true));
  it("間の空白が2つでも1つと同じ", () => expect(grade("cell  membrane", "cell membrane")).toBe(true));
});

describe("gradeMeaningToTerm：不正解にする", () => {
  it("答えが空", () => expect(grade("", "葉緑体")).toBe(false));
  it("空白だけ", () => expect(grade("   ", "葉緑体")).toBe(false));
  it("一部だけ合っている（部分一致は正解にしない）", () => expect(grade("葉緑", "葉緑体")).toBe(false));
  it("ひらがなとカタカナは別の答え", () => expect(grade("ようりょくたい", "ヨウリョクタイ")).toBe(false));
  it("間の空白のあり・なしは別の答え", () => expect(grade("光 合成", "光合成")).toBe(false));
});
