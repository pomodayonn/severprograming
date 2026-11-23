// 単体テスト：searchTree（左の一覧の検索）
// 科目名で合えばその科目の学習項目を全部、学習項目名で合えばその項目だけを出す
import { describe, expect, it } from "vitest";
import { nameHas, searchTree } from "../../src/lib/select";
import { Subject } from "../../src/beans/Subject";
import { LearningItem } from "../../src/beans/LearningItem";

const subjects = [new Subject({ subjectId: "bio", subjectName: "理科" }), new Subject({ subjectId: "eng", subjectName: "English" })];
const items = [
  new LearningItem({ itemId: "i1", subjectId: "bio", itemName: "光合成" }),
  new LearningItem({ itemId: "i2", subjectId: "bio", itemName: "呼吸" }),
  new LearningItem({ itemId: "i3", subjectId: "eng", itemName: "現在完了" }),
];
const names = (m: Map<string, LearningItem[]> | null, id: string) => m?.get(id)?.map(i => i.itemName);

describe("nameHas：名前に言葉が入っているか", () => {
  it("大文字小文字は区別しない", () => expect(nameHas("English", "eng")).toBe(true));
  it("全角と半角は区別しない", () => expect(nameHas("English", "ＥＮＧ")).toBe(true));
  it("入っていなければ false", () => expect(nameHas("理科", "数学")).toBe(false));
});

describe("searchTree：左の一覧の検索", () => {
  it("言葉が空なら null（全部出す）", () => expect(searchTree(subjects, items, "  ")).toBeNull());
  it("学習項目名で合えば、その項目だけ", () => {
    const m = searchTree(subjects, items, "光合");
    expect(names(m, "bio")).toEqual(["光合成"]);
    expect(m!.has("eng")).toBe(false);
  });
  it("科目名で合えば、その科目の学習項目を全部", () => expect(names(searchTree(subjects, items, "理科"), "bio")).toEqual(["光合成", "呼吸"]));
  it("どこにも合わなければ空", () => expect(searchTree(subjects, items, "化学")!.size).toBe(0));
  it("学習項目がまだない科目も、科目名で合えば出す", () => {
    const m = searchTree([...subjects, new Subject({ subjectId: "math", subjectName: "数学" })], items, "数学");
    expect(names(m, "math")).toEqual([]);
  });
});
