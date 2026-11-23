// 単体テスト：lib/logic.ts（画面にもデータベースにも関係しない、小さな計算）
// 校正の「元→先」の置き換え、テキストのファイル名、問題数、ノートに置く部品の大きさと位置を確かめる
import { describe, expect, it } from "vitest";
import { bottomY, chunkText, clampQuestionCount, isCorrect, newPart, parseReplace, replaceText, txtName } from "../../src/lib/logic";
import { NotePart } from "../../src/beans/NotePart";
import { PartType } from "../../src/enums/PartType";

describe("parseReplace：「元→先」の指示を読む", () => {
  it("「→」で分ける", () => expect(parseReplace("光合性→光合成")).toEqual({ from: "光合性", to: "光合成" }));
  it("「->」でも分ける", () => expect(parseReplace("teh -> the")).toEqual({ from: "teh", to: "the" }));
  it("前後の空白は消す", () => expect(parseReplace("  あ  →  い  ")).toEqual({ from: "あ", to: "い" }));
  it("「→」がなければ null", () => expect(parseReplace("光合成")).toBeNull());
  it("元の文字が空なら null", () => expect(parseReplace("→光合成")).toBeNull());
  it("先が空なら「消す」指示になる", () => expect(parseReplace("えーと→")).toEqual({ from: "えーと", to: "" }));
});

describe("replaceText：指示どおりに置き換える", () => {
  it("すべての場所を置き換える", () => expect(replaceText("光合性と光合性", { from: "光合性", to: "光合成" })).toBe("光合成と光合成"));
  it("見つからなければそのまま", () => expect(replaceText("気孔", { from: "葉", to: "根" })).toBe("気孔"));
  it("記号もそのまま探す（正規表現として読まない）", () => expect(replaceText("a.b.c", { from: ".", to: "-" })).toBe("a-b-c"));
});

describe("txtName：テキストのファイル名がかぶらないようにする", () => {
  it("かぶらなければそのまま", () => expect(txtName("資料", [])).toBe("資料.txt"));
  it("かぶったら (2) を付ける", () => expect(txtName("資料", ["資料.txt"])).toBe("資料(2).txt"));
  it("(2) もかぶったら (3)", () => expect(txtName("資料", ["資料.txt", "資料(2).txt"])).toBe("資料(3).txt"));
});

describe("clampQuestionCount：問題数を5〜20問にそろえる", () => {
  it("5〜20はそのまま", () => expect(clampQuestionCount(12)).toBe(12));
  it("少なすぎれば5問", () => expect(clampQuestionCount(1)).toBe(5));
  it("多すぎれば20問", () => expect(clampQuestionCount(99)).toBe(20));
  it("小数は四捨五入", () => expect(clampQuestionCount(7.6)).toBe(8));
  it("数でなければ10問", () => expect(clampQuestionCount(NaN)).toBe(10));
});

describe("chunkText：長い文を決まった長さで分ける", () => {
  it("空なら空の1つ", () => expect(chunkText("")).toEqual([""]));
  it("ちょうどの長さなら1つ", () => expect(chunkText("あ".repeat(1200))).toHaveLength(1));
  it("1文字でも超えたら2つ", () => expect(chunkText("あ".repeat(1201)).map(s => s.length)).toEqual([1200, 1]));
  it("長さは変えられる", () => expect(chunkText("abcdefg", 3)).toEqual(["abc", "def", "g"]));
});

describe("isCorrect：単語テストの正解の判定", () => {
  it("全角と半角は同じとみなす", () => expect(isCorrect("ＤＮＡ", "DNA")).toBe(true));
  it("空の答えは不正解", () => expect(isCorrect("   ", "")).toBe(false));
  it("一部だけ合っていても不正解", () => expect(isCorrect("光合", "光合成")).toBe(false));
});

describe("newPart・bottomY：ノートに置く新しい部品", () => {
  it("単語枠は単語の行を1つ持って作られる", () => {
    const p = newPart(PartType.FRAME, 0, "word");
    expect(p.words).toHaveLength(1);
    expect(p.words[0].partId).toBe(p.partId);
  });
  it("単語枠でない枠は単語を持たない", () => expect(newPart(PartType.FRAME, 0, "problem").words).toHaveLength(0));
  it("枠の種類を渡さなければ要約枠", () => expect(newPart(PartType.FRAME, 0).frameType).toBe("summary"));
  it("枠でなければ枠の種類は null", () => expect(newPart(PartType.TEXT, 0).frameType).toBeNull());
  it("図形は四角で作られる", () => expect(NotePart.shapeOf(newPart(PartType.SHAPE, 0))).toBe("rect"));
  it("渡した高さに置かれる", () => expect(newPart(PartType.ARROW, 250).y).toBe(250));
  it("作るたびに別のIDになる", () => expect(newPart(PartType.TEXT, 0).partId === newPart(PartType.TEXT, 0).partId).toBe(false));
  it("部品がなければ上から36pxの所", () => expect(bottomY([])).toBe(36));
  it("いちばん下の部品より36px下", () => {
    const parts = [new NotePart({ y: 0, height: 100 }), new NotePart({ y: 300, height: 50 }), new NotePart({ y: 120, height: 40 })];
    expect(bottomY(parts)).toBe(386);
  });
});
