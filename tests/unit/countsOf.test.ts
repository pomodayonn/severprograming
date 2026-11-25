// 単体テスト：countsOf（科目の中身の数）
// 科目一覧の「学習項目・テスト・資料」の数と、科目を削除するときの確認の文に使う。ほかの科目のものを数えないか確かめる
import { describe, expect, it } from "vitest";
import { countsOf } from "../../src/lib/select";
import { LearningItem } from "../../src/beans/LearningItem";
import { Test } from "../../src/beans/Test";
import { Material } from "../../src/beans/Material";

const items = [new LearningItem({ itemId: "i1", subjectId: "bio" }), new LearningItem({ itemId: "i2", subjectId: "bio" }), new LearningItem({ itemId: "i3", subjectId: "math" })];
const tests = [new Test({ itemId: "i1" }), new Test({ itemId: "i1" }), new Test({ itemId: "i2" }), new Test({ itemId: "i3" })];
const materials = [new Material({ itemId: "i2" }), new Material({ itemId: "i3" })];

describe("countsOf：科目の中身の数", () => {
  it("その科目の学習項目・テスト・資料を数える", () => expect(countsOf("bio", items, tests, materials)).toEqual({ items: 2, tests: 3, materials: 1 }));
  it("ほかの科目のものは数えない", () => expect(countsOf("math", items, tests, materials)).toEqual({ items: 1, tests: 1, materials: 1 }));
  it("中身のない科目は全部0", () => expect(countsOf("eng", items, tests, materials)).toEqual({ items: 0, tests: 0, materials: 0 }));
});
