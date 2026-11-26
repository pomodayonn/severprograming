// 単体テスト：学習項目の前提関係に関する回帰テスト

import { describe, expect, it } from "vitest";

import {
  hasCycle,
  planLinks,
  type Link,
} from "../../src/lib/logic";

//「item の前に pre を学ぶ」という関係を作る
const p = (item: string, pre: string): Link => ({
  itemId: item,
  prereqItemId: pre,
});

// 既存の前提関係を維持しながら、新しい前提項目を追加する
// 追加後の関連図全体に循環がある場合は true を返す
const cycle = (
  list: Link[],
  item: string,
  pre: string
): boolean => {
  const before = list
    .filter(link => link.itemId === item)
    .map(link => link.prereqItemId);

  const plan = planLinks(list, item, [...before, pre]);

  return hasCycle(plan.result);
};

describe("前提関係：循環しない正常な設定", () => {

  it("前提がまだない場合", () => {
    expect(cycle([], "A", "B")).toBe(false);
  });

  it("関係のない項目どうしを接続する場合", () => {
    expect(
      cycle([p("C", "D")], "A", "B")
    ).toBe(false);
  });

  it("同じ前提を2つの項目で使用する場合", () => {
    const list = [
      p("B", "D"),
      p("C", "D"),
      p("A", "B"),
    ];

    expect(cycle(list, "A", "C")).toBe(false);
  });

  it("前提の前提が存在する場合", () => {
    expect(
      cycle([p("B", "C")], "A", "B")
    ).toBe(false);
  });

});

describe("前提関係：循環する不正な設定", () => {

  it("自分自身を前提にする場合", () => {
    expect(cycle([], "A", "A")).toBe(true);
  });

  it("2つの学習項目で循環する場合", () => {
    expect(
      cycle([p("B", "A")], "A", "B")
    ).toBe(true);
  });

  it("3つの学習項目で循環する場合", () => {
    const list = [
      p("B", "A"),
      p("C", "B"),
    ];

    expect(cycle(list, "A", "C")).toBe(true);
  });

  it("既存の別の循環も検出する場合", () => {
    const list = [
      p("X", "Y"),
      p("Y", "X"),
      p("B", "X"),
    ];

    expect(cycle(list, "A", "B")).toBe(true);
  });

});

describe("前提関係：循環の解消", () => {

  it("循環している関係を削除すると正常になる", () => {
    const list = [
      p("X", "Y"),
      p("Y", "X"),
    ];

    // 修正前は循環している
    expect(hasCycle(list)).toBe(true);

    // X の前提関係を解除する
    const plan = planLinks(list, "X", []);

    // 修正後は循環していない
    expect(hasCycle(plan.result)).toBe(false);
  });

});
