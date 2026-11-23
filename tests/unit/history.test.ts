// 単体テスト：lib/history.ts（ノートの「元に戻す」「やり直す」）
// 続けての変更（文字を打つ・ドラッグ）は1回分にまとめること、戻す・やり直すの順番、上限を確かめる
import { describe, expect, it } from "vitest";
import { GAP, LIMIT, emptyHistory, record, redo, undo } from "../../src/lib/history";

describe("record：変える前の形を覚える", () => {
  it("間があいた変更は、1回ずつ覚える", () => {
    let h = emptyHistory<string>();
    h = record(h, "A", 0); h = record(h, "B", GAP + 1);
    expect(h.past).toEqual(["A", "B"]);
  });
  it("続けての変更は1回分にまとめる（最初の形だけ）", () => {
    let h = emptyHistory<string>();
    h = record(h, "A", 0); h = record(h, "AB", 100); h = record(h, "ABC", 200);
    expect(h.past).toEqual(["A"]);
  });
  it("新しく変えたら、やり直しの分は消える", () => {
    let h = emptyHistory<string>();
    h = record(h, "A", 0);
    h = undo(h, "B")!.h;
    expect(record(h, "A", 5000).future).toHaveLength(0);
  });
  it(`覚えるのは ${LIMIT} 回まで（古いものから消える）`, () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < LIMIT + 5; i++) h = record(h, i, i * (GAP + 1));
    expect(h.past).toHaveLength(LIMIT);
    expect(h.past[0]).toBe(5);
  });
});

describe("undo・redo：戻す・やり直す", () => {
  const h0 = record(record(emptyHistory<string>(), "A", 0), "B", GAP + 1); // A → B → C と変えた
  it("元に戻すと1つ前の形になる", () => expect(undo(h0, "C")!.value).toBe("B"));
  it("2回戻すと2つ前の形になる", () => { const r = undo(h0, "C")!; expect(undo(r.h, r.value)!.value).toBe("A"); });
  it("戻したあと、やり直すと元の形になる", () => { const r = undo(h0, "C")!; expect(redo(r.h, r.value)!.value).toBe("C"); });
  it("履歴がなければ戻せない（null）", () => expect(undo(emptyHistory<string>(), "A")).toBeNull());
  it("戻していなければ、やり直せない（null）", () => expect(redo(h0, "C")).toBeNull());
  it("戻した直後の変更は、まとめずに1回分として覚える", () => {
    const r = undo(h0, "C")!;
    expect(record(r.h, "B", 1).past).toEqual(["A", "B"]);
  });
});
