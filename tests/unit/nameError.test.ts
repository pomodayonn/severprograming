// 単体テスト：nameError（科目名・学習項目名の確認）
// 画面のポップアップと Manager の checkName が同じルールを使う（11/23）。絵文字も1文字と数える
import { describe, expect, it } from "vitest";
import { nameError, NAME_MAX } from "../../src/lib/logic";

describe("nameError：名前の確認", () => {
  it("ふつうの名前はOK（null）", () => expect(nameError("数学", "科目名")).toBeNull());
  it("空・空白だけはだめ", () => {
    expect(nameError("", "科目名")).toBe("科目名を入力してください");
    expect(nameError("   ", "科目名")).toBe("科目名を入力してください");
  });
  it("50文字ちょうどはOK、51文字はだめ", () => {
    expect(nameError("あ".repeat(NAME_MAX), "名前")).toBeNull();
    expect(nameError("あ".repeat(NAME_MAX + 1), "名前")).toBe("名前は50文字までです");
  });
  it("絵文字も1文字と数える（50個はOK）", () => expect(nameError("📘".repeat(50), "名前")).toBeNull());
  it("前後の空白は数えない", () => expect(nameError(` ${"あ".repeat(50)} `, "名前")).toBeNull());
});
