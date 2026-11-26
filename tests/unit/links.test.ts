// 単体テスト：学習項目のつながり（関連図の線）
// hasCycle：線をたどって一周する所があるか。planLinks：「前に学ぶ」「次に学ぶ」を決めたときに足す線・消す線
// byName：名前の順に並べる。nextIdsOf：その項目のあとに学ぶ項目
import { describe, expect, it } from "vitest";
import { byName, hasCycle, planLinks, type Link } from "../../src/lib/logic";
import { nextIdsOf } from "../../src/lib/select";
import { Prerequisite } from "../../src/beans/Prerequisite";

/** 「item の前に pre を学ぶ」線 */
const l = (item: string, pre: string): Link => ({ itemId: item, prereqItemId: pre });
const key = (xs: Link[]) => xs.map(x => `${x.prereqItemId}→${x.itemId}`).sort();

describe("hasCycle：一周しない（設定してよい）", () => {
  it("線がない", () => expect(hasCycle([])).toBe(false));
  it("一本道（C → B → A）", () => expect(hasCycle([l("B", "C"), l("A", "B")])).toBe(false));
  it("ひし形（D から B と C に分かれて A で合流）", () => expect(hasCycle([l("B", "D"), l("C", "D"), l("A", "B"), l("A", "C")])).toBe(false));
  it("関係のない2つのまとまり", () => expect(hasCycle([l("B", "A"), l("Y", "X")])).toBe(false));
});

describe("hasCycle：一周する（設定させない）", () => {
  it("自分から自分", () => expect(hasCycle([l("A", "A")])).toBe(true));
  it("2つで一周（A → B → A）", () => expect(hasCycle([l("B", "A"), l("A", "B")])).toBe(true));
  it("3つで一周（A → B → C → A）", () => expect(hasCycle([l("B", "A"), l("C", "B"), l("A", "C")])).toBe(true));
  it("一周しない部分がついていても見つける", () => expect(hasCycle([l("Z", "A"), l("B", "A"), l("C", "B"), l("A", "C")])).toBe(true));
});

describe("planLinks：前に学ぶ項目だけを決める（after を渡さない）", () => {
  it("新しく足す", () => {
    const r = planLinks([], "A", ["B", "C"]);
    expect(key(r.add)).toEqual(["B→A", "C→A"]); expect(r.remove).toEqual([]);
  });
  it("外したものは消し、残したものはそのまま", () => {
    const r = planLinks([l("A", "B"), l("A", "C")], "A", ["C", "D"]);
    expect(key(r.add)).toEqual(["D→A"]); expect(key(r.remove)).toEqual(["B→A"]); expect(key(r.result)).toEqual(["C→A", "D→A"]);
  });
  it("A のあとに学ぶ線とほかの線は残す", () => {
    const r = planLinks([l("X", "A"), l("Y", "Z")], "A", []);
    expect(r.remove).toEqual([]); expect(key(r.result)).toEqual(["A→X", "Z→Y"]);
  });
  it("同じ ID が2回あっても1本にする", () => expect(planLinks([], "A", ["B", "B"]).add).toHaveLength(1));
});

describe("planLinks：次に学ぶ項目も決める", () => {
  it("次に学ぶ項目への線を足す", () => {
    const r = planLinks([], "A", ["B"], ["C"]);
    expect(key(r.add)).toEqual(["A→C", "B→A"]);
  });
  it("外した次の項目への線は消す", () => {
    const r = planLinks([l("X", "A"), l("Y", "A")], "A", [], ["Y"]);
    expect(key(r.remove)).toEqual(["A→X"]); expect(r.add).toEqual([]);
  });
  it("前と次の両方に同じ項目を入れると一周になる", () => expect(hasCycle(planLinks([], "A", ["B"], ["B"]).result)).toBe(true));
  it("次に学ぶ項目が、A の前に学ぶ項目の前にあると一周になる（B → A → C → B）", () =>
    expect(hasCycle(planLinks([l("B", "C")], "A", ["B"], ["C"]).result)).toBe(true));
});

describe("byName・nextIdsOf", () => {
  it("名前の順に並べ、元の配列は変えない", () => {
    const xs = [{ itemName: "さかな" }, { itemName: "あめ" }, { itemName: "かさ" }, { itemName: "Abc" }];
    expect(byName(xs).map(x => x.itemName)).toEqual(["Abc", "あめ", "かさ", "さかな"]);
    expect(xs[0].itemName).toBe("さかな");
  });
  it("その項目のあとに学ぶ項目を返す", () => {
    const ps = [new Prerequisite({ itemId: "B", prereqItemId: "A" }), new Prerequisite({ itemId: "C", prereqItemId: "A" }), new Prerequisite({ itemId: "A", prereqItemId: "Z" })];
    expect(nextIdsOf(ps, "A").sort()).toEqual(["B", "C"]);
    expect(nextIdsOf(ps, "C")).toEqual([]);
  });
});
