// 単体テスト：箇条書き・番号付きリスト（lib/rich.ts の toggleList・continueList・spliceRich）
// 行の頭に「・ 」「1. 」を付け外しできるか、Enter で次の印が付くか、書式（太字など）が文字といっしょにずれるかを確かめる
import { describe, expect, it } from "vitest";
import { continueList, listOf, spliceRich, toggleList } from "../../src/lib/rich";

describe("spliceRich：文字を入れたり消したりすると、書式もいっしょにずれる", () => {
  it("前に入れると、後ろの書式がずれる", () => expect(spliceRich("光合成", [{ s: 0, e: 3, b: true }], 0, 0, "・ ")).toEqual({ text: "・ 光合成", runs: [{ s: 2, e: 5, b: true }] }));
  it("消すと、後ろの書式が前にずれる", () => expect(spliceRich("・ 光合成", [{ s: 2, e: 5, b: true }], 0, 2, "")).toEqual({ text: "光合成", runs: [{ s: 0, e: 3, b: true }] }));
});

describe("toggleList：箇条書き・番号の付け外し", () => {
  it("選んだ行に「・ 」を付ける", () => expect(toggleList("気孔\n葉緑体\nデンプン", [], 0, 5, "ul").text).toBe("・ 気孔\n・ 葉緑体\nデンプン"));
  it("番号は 1. 2. と順に付ける", () => expect(toggleList("気孔\n葉緑体", [], 0, 6, "ol").text).toBe("1. 気孔\n2. 葉緑体"));
  it("全部の行がもう箇条書きなら外す", () => expect(toggleList("・ 気孔\n・ 葉緑体", [], 0, 9, "ul").text).toBe("気孔\n葉緑体"));
  it("箇条書きを番号に変える", () => expect(toggleList("・ 気孔\n・ 葉緑体", [], 0, 9, "ol").text).toBe("1. 気孔\n2. 葉緑体"));
  it("カーソルだけでも、その1行に付く", () => expect(toggleList("気孔\n葉緑体", [], 4, 4, "ul").text).toBe("気孔\n・ 葉緑体"));
  it("付けたあと、同じ行を選び直す範囲を返す", () => expect(toggleList("気孔\n葉緑体", [], 0, 6, "ul").sel).toEqual([0, 10]));
  it("印の行の見分け", () => { expect(listOf("・ あ")).toBe("ul"); expect(listOf("12. あ")).toBe("ol"); expect(listOf("あ")).toBeNull(); });
});

describe("continueList：箇条書きの行で Enter", () => {
  it("次の行にも「・ 」が付く", () => expect(continueList("・ 気孔", [], 4)).toEqual({ text: "・ 気孔\n・ ", runs: [], caret: 7 }));
  it("番号は次の数になる", () => expect(continueList("1. 気孔", [], 5)?.text).toBe("1. 気孔\n2. "));
  it("印だけの行で Enter を押すと、箇条書きが終わる", () => expect(continueList("・ 気孔\n・ ", [], 7)).toEqual({ text: "・ 気孔\n", runs: [], caret: 5 }));
  it("箇条書きでない行は null（ふつうの改行）", () => expect(continueList("気孔", [], 2)).toBeNull());
});
