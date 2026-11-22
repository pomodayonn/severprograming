// 単体テスト：lib/words.ts（単語枠の「用語：意味」の行と、単語のリストの行き来）
// 前は区切り方がそろっておらず「集合時刻：12:30」の意味が「1230」になるバグがあった。その再発を防ぐ
import { describe, expect, it } from "vitest";
import { lineToWord, textToWords, wordsToText } from "../../src/lib/words";

describe("lineToWord：1行を用語と意味に分ける", () => {
  it("全角の「：」で分ける", () => expect(lineToWord("葉緑体：光合成をする粒")).toEqual({ term: "葉緑体", meaning: "光合成をする粒" }));
  it("半角の「:」でも分ける", () => expect(lineToWord("DNA: 遺伝情報")).toEqual({ term: "DNA", meaning: "遺伝情報" }));
  it("2つ目の「：」は意味に残す（前のバグ）", () => expect(lineToWord("集合時刻：12:30")).toEqual({ term: "集合時刻", meaning: "12:30" }));
  it("「：」がなければ「とは」で分ける", () => expect(lineToWord("光合成とは光で糖を作ること")).toEqual({ term: "光合成", meaning: "光で糖を作ること" }));
  it("区切りがなければ用語だけ", () => expect(lineToWord("気孔")).toEqual({ term: "気孔", meaning: "" }));
});

describe("textToWords・wordsToText：行き来しても変わらない", () => {
  it("空の行は飛ばす", () => expect(textToWords("葉緑体：粒\n\n気孔：すきま\n")).toHaveLength(2));
  it("リスト → 文字 → リストで元に戻る", () => {
    const words = [{ term: "葉緑体", meaning: "光合成：をする粒" }, { term: "集合時刻", meaning: "12:30" }];
    expect(textToWords(wordsToText(words))).toEqual(words);
  });
});
