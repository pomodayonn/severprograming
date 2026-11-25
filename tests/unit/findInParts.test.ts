// 単体テスト：findInParts（ノートの中の検索）
// 文字・枠・単語枠（用語と意味）から探せるか、読む順（上から下、左から右）に並ぶか、図形・矢印は探さないか、全角半角・大文字小文字を区別しないかを確かめる
import { describe, expect, it } from "vitest";
import { findInParts, fold } from "../../src/lib/logic";
import { NotePart } from "../../src/beans/NotePart";
import { Word } from "../../src/beans/Word";
import { PartType } from "../../src/enums/PartType";

const parts = [
  new NotePart({ partId: "low", partType: PartType.TEXT, x: 0, y: 300, text: "光合成のまとめ" }),
  new NotePart({ partId: "top", partType: PartType.FRAME, frameType: "summary", x: 0, y: 10, text: "光合成は葉で行う。光合成には光がいる" }),
  new NotePart({ partId: "w", partType: PartType.FRAME, frameType: "word", x: 400, y: 10, words: [new Word({ term: "葉緑体", meaning: "光合成をする粒" })] }),
  new NotePart({ partId: "s", partType: PartType.SHAPE, x: 0, y: 0, text: "rect" }),
];

describe("findInParts：ノートの中の検索", () => {
  const hits = findInParts(parts, "光合成");
  it("読む順に全部見つける（同じ枠に2つあれば2つ）", () => expect(hits.map(h => h.partId)).toEqual(["top", "top", "w", "low"]));
  it("何文字目かも分かる", () => expect(hits.slice(0, 2).map(h => [h.start, h.end])).toEqual([[0, 3], [9, 12]]));
  it("単語枠は、用語か意味か、何番目の単語かも分かる", () => expect(hits[2]).toEqual({ partId: "w", field: "meaning", word: 0, start: 0, end: 3 }));
  it("図形の中の文字（rect）は探さない", () => expect(findInParts(parts, "rect")).toHaveLength(0));
  it("全角・半角、大文字・小文字は区別しない", () => expect(findInParts([new NotePart({ partId: "e", partType: PartType.TEXT, text: "ＤＮＡとdna" })], "Dna")).toHaveLength(2));
  it("空なら何も探さない", () => expect(findInParts(parts, "  ")).toHaveLength(0));
  it("fold は文字の数を変えない", () => expect(fold("ＡＢｃ㍿").length).toBe(4));
});
