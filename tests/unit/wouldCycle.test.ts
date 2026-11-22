// 単体テスト：LearningItemManager.wouldCycle（前提項目が輪にならないかの確認）
// 「A の前提に B を足す」とき、B の前提をたどって A に着いたら輪になる → true（設定させない）
// wouldCycle は private なので、テストの中だけ型を外して呼ぶ（動きは画面の「前提項目の設定」と同じ）
import { describe, expect, it } from "vitest";
import { LearningItemManager } from "../../src/managers/LearningItemManager";
import { Prerequisite } from "../../src/beans/Prerequisite";

type CycleCheck = { wouldCycle(list: Prerequisite[], itemId: string, pre: string): boolean };
const manager = Object.create(LearningItemManager.prototype) as CycleCheck; // DAO はいらないので、コンストラクタは通さない
/** 「item の前提は pre」の組み合わせ */
const p = (item: string, pre: string) => new Prerequisite({ itemId: item, prereqItemId: pre });
const cycle = (list: Prerequisite[], item: string, pre: string) => manager.wouldCycle(list, item, pre);

describe("wouldCycle：輪にならない（設定してよい）", () => {
  it("前提がまだない", () => expect(cycle([], "A", "B")).toBe(false));
  it("関係のない項目どうし", () => expect(cycle([p("C", "D")], "A", "B")).toBe(false));
  it("同じ前提を2つの項目で使う（ひし形）", () => {
    // B と C の前提が D。A の前提に B と C を足しても輪にならない
    const list = [p("B", "D"), p("C", "D"), p("A", "B")];
    expect(cycle(list, "A", "C")).toBe(false);
  });
  it("前提の前提がある（A ← B ← C の向きに足す）", () => expect(cycle([p("B", "C")], "A", "B")).toBe(false));
});

describe("wouldCycle：輪になる（設定させない）", () => {
  it("自分自身を前提にする", () => expect(cycle([], "A", "A")).toBe(true));
  it("2つで輪（B の前提が A なのに、A の前提に B）", () => expect(cycle([p("B", "A")], "A", "B")).toBe(true));
  it("3つで輪（C ← B ← A のあとに、A の前提に C）", () => expect(cycle([p("B", "A"), p("C", "B")], "A", "C")).toBe(true));
  it("すでにある別の輪で止まらずに答えを返す", () => {
    // X と Y がすでに輪になっていても、無限にたどらずに終わる
    const list = [p("X", "Y"), p("Y", "X"), p("B", "X")];
    expect(cycle(list, "A", "B")).toBe(false);
  });
});
