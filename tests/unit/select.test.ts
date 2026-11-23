// 単体テスト：lib/select.ts（画面が beans の中から「欲しいもの」を IDで探す関数）
// 別の科目・別の学習項目のものがまざらないか、並び順が正しいか、見つからないときに落ちないかを確かめる
import { describe, expect, it } from "vitest";
import { answerOf, attemptsOf, itemsOf, lastScore, partsOf, prereqIdsOf, questionsOf } from "../../src/lib/select";
import { TestType } from "../../src/enums/TestType";
import { LearningItem } from "../../src/beans/LearningItem";
import { Prerequisite } from "../../src/beans/Prerequisite";
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { Attempt } from "../../src/beans/Attempt";
import { Answer } from "../../src/beans/Answer";

const items = [
  new LearningItem({ itemId: "i1", subjectId: "bio", itemName: "細胞" }),
  new LearningItem({ itemId: "i2", subjectId: "math", itemName: "関数" }),
  new LearningItem({ itemId: "i3", subjectId: "bio", itemName: "光合成" }),
];

describe("itemsOf：その科目の学習項目", () => {
  it("その科目のものだけを、作った順に返す", () => expect(itemsOf(items, "bio").map(i => i.itemName)).toEqual(["細胞", "光合成"]));
  it("学習項目がない科目は空", () => expect(itemsOf(items, "eng")).toHaveLength(0));
  it("科目を選んでいなければ空", () => expect(itemsOf(items, undefined)).toHaveLength(0));
});

describe("prereqIdsOf：その学習項目の前提", () => {
  const pre = [
    new Prerequisite({ itemId: "i3", prereqItemId: "i1" }),
    new Prerequisite({ itemId: "i3", prereqItemId: "i2" }),
    new Prerequisite({ itemId: "i2", prereqItemId: "i1" }),
  ];
  it("その学習項目の前提のIDだけを返す", () => expect(prereqIdsOf(pre, "i3")).toEqual(["i1", "i2"]));
  it("前提がなければ空", () => expect(prereqIdsOf(pre, "i1")).toHaveLength(0));
});

describe("partsOf：その学習項目のノートの部品", () => {
  const notes = [new Note({ itemId: "i1", parts: [new NotePart({ partId: "p1" }), new NotePart({ partId: "p2" })] })];
  it("ノートの部品を返す", () => expect(partsOf(notes, "i1").map(p => p.partId)).toEqual(["p1", "p2"]));
  it("ノートがまだなければ空（落ちない）", () => expect(partsOf(notes, "i9")).toHaveLength(0));
  it("学習項目を選んでいなければ空", () => expect(partsOf(notes, undefined)).toHaveLength(0));
  it("ノートがないときは、毎回同じ空のリストを返す（画面の描き直しを増やさない）", () => expect(partsOf([], "a") === partsOf([], "b")).toBe(true));
});

describe("questionsOf・attemptsOf：番号の順に並べる", () => {
  const test = new Test({
    questions: [new Question({ questionId: "q3", number: 3 }), new Question({ questionId: "q1", number: 1 }), new Question({ questionId: "q2", number: 2 })],
    attempts: [new Attempt({ attemptId: "a2", attemptNo: 2 }), new Attempt({ attemptId: "a1", attemptNo: 1 })],
  });
  it("問題は問題番号の順", () => expect(questionsOf(test).map(q => q.questionId)).toEqual(["q1", "q2", "q3"]));
  it("受験は1回目から順", () => expect(attemptsOf(test).map(a => a.attemptId)).toEqual(["a1", "a2"]));
  it("並べても元のテストの順番は変えない", () => {
    questionsOf(test);
    expect(test.questions.map(q => q.questionId)).toEqual(["q3", "q1", "q2"]);
  });
});

describe("answerOf：その受験の、その問題への解答", () => {
  const attempt = new Attempt({ answers: [new Answer({ questionId: "q1", studentAnswer: "葉緑体" })] });
  it("解答を返す", () => expect(answerOf(attempt, "q1")?.studentAnswer).toBe("葉緑体"));
  it("まだ答えていない問題は undefined", () => expect(answerOf(attempt, "q2")).toBeUndefined());
  it("受験がまだなければ undefined（落ちない）", () => expect(answerOf(undefined, "q1")).toBeUndefined());
});

describe("lastScore：テスト一覧に出す前回の点数", () => {
  const qs = [new Question({ questionId: "q1" }), new Question({ questionId: "q2" }), new Question({ questionId: "q3" })];
  const att = (no: number, ok: boolean[]) => new Attempt({ attemptNo: no, answers: ok.map((c, i) => new Answer({ questionId: `q${i + 1}`, correct: c })) });
  it("いちばん新しい回の正解数を数える", () => {
    const t = new Test({ testType: TestType.MEANING_TO_TERM, questions: qs, attempts: [att(2, [true, true, false]), att(1, [false, false, false])] });
    expect(lastScore(t)).toEqual({ ok: 2, total: 3, attemptNo: 2 });
  });
  it("まだ解いていなければ null", () => expect(lastScore(new Test({ testType: TestType.MEANING_TO_TERM, questions: qs }))).toBeNull());
  it("採点のない記述テストは null", () => expect(lastScore(new Test({ testType: TestType.ESSAY, questions: qs, attempts: [att(1, [true])] }))).toBeNull());
});
