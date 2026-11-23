// 単体テスト：sortTests（テスト一覧の並べかえ）
// 作った日・最近解いた・前回の点数が低い・学習項目の名前の順に並ぶか。解いていないテストや点数のないテストは後ろ
import { describe, expect, it } from "vitest";
import { sortTests } from "../../src/lib/select";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { Attempt } from "../../src/beans/Attempt";
import { Answer } from "../../src/beans/Answer";
import { LearningItem } from "../../src/beans/LearningItem";
import { TestType } from "../../src/enums/TestType";

const qs = [new Question({ questionId: "q1" }), new Question({ questionId: "q2" })];
const row = (id: string, item: string, created: string, opt: { taken?: string; ok?: boolean[]; type?: TestType } = {}) => ({
  i: new LearningItem({ itemName: item }),
  t: new Test({
    testId: id, createdAt: created, lastTakenAt: opt.taken ?? null, testType: opt.type ?? TestType.MEANING_TO_TERM, questions: qs,
    attempts: opt.ok ? [new Attempt({ attemptNo: 1, answers: opt.ok.map((c, k) => new Answer({ questionId: `q${k + 1}`, correct: c })) })] : [],
  }),
});
const rows = [
  row("A", "呼吸", "2026-11-01", { taken: "2026-11-20", ok: [true, true] }),
  row("B", "光合成", "2026-11-10"),
  row("C", "細胞", "2026-11-05", { taken: "2026-11-22", ok: [false, true] }),
  row("D", "遺伝", "2026-11-03", { taken: "2026-11-21", ok: [true], type: TestType.ESSAY }),
];
const ids = (by: Parameters<typeof sortTests>[1]) => sortTests(rows, by).map(r => r.t.testId).join("");

describe("sortTests：テスト一覧の並べかえ", () => {
  it("作った日が新しい順", () => expect(ids("new")).toBe("BCDA"));
  it("作った日が古い順", () => expect(ids("old")).toBe("ADCB"));
  it("最近解いた順（まだ解いていないテストは後ろ）", () => expect(ids("taken")).toBe("CDAB"));
  it("前回の点数が低い順（点数のない未受験・記述は後ろ）", () => expect(ids("low")).toBe("CABD"));
  it("学習項目の名前順（ひらがな・カタカナはあいうえお順。漢字は読みが分からないので文字の順）", () => {
    const kana = [row("A", "こきゅう", "2026-11-01"), row("B", "コウゴウセイ", "2026-11-02"), row("C", "さいぼう", "2026-11-03"), row("D", "いでん", "2026-11-04")];
    expect(sortTests(kana, "name").map(r => r.t.testId).join("")).toBe("DBAC");
  });
  it("元の並びは変えない", () => { sortTests(rows, "old"); expect(rows.map(r => r.t.testId).join("")).toBe("ABCD"); });
});
