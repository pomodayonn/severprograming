// 単体テスト：SendContentManager.split（AIに送る内容を1万文字ごとに分ける）
// 1万文字を超えたら分け、なるべく改行の所で切る。分けた数だけAIの利用回数を使う
import { describe, expect, it } from "vitest";
import { SendContentManager } from "../../src/managers/SendContentManager";
import { SendContent } from "../../src/beans/SendContent";
import { SEND_LIMIT, calls } from "../../src/lib/logic";

const manager = new SendContentManager();
const split = (text: string) => manager.split(new SendContent({ text }));
const len = (s: string) => [...s].length; // 絵文字なども1文字として数える

describe("split：分けない", () => {
  it("空のとき、空の1つを返す", () => expect(split("")).toEqual([""]));
  it("ちょうど1万文字は1つのまま", () => expect(split("あ".repeat(SEND_LIMIT))).toHaveLength(1));
});

describe("split：分ける", () => {
  it("1万1文字は2つ（1万文字と1文字）", () => {
    const out = split("あ".repeat(SEND_LIMIT + 1));
    expect(out.map(len)).toEqual([SEND_LIMIT, 1]);
  });
  it("2万5千文字は3つ", () => expect(split("あ".repeat(25000))).toHaveLength(3));
  it("後ろ2割の中に改行があれば、改行の直後で切る", () => {
    const head = "あ".repeat(9000) + "\n"; // 9001文字目が改行（1万文字の8割より後ろ）
    const out = split(head + "い".repeat(3000));
    expect(out[0]).toBe(head);
    expect(out[1]).toBe("い".repeat(3000));
  });
  it("改行が前の方（8割より前）にしかなければ、ちょうど1万文字で切る", () => {
    const text = "あ".repeat(100) + "\n" + "い".repeat(12000);
    expect(len(split(text)[0])).toBe(SEND_LIMIT);
  });
  it("絵文字（2つの文字コードでできた文字）を途中で切らない", () => {
    const out = split("😀".repeat(SEND_LIMIT + 5));
    expect(out.map(len)).toEqual([SEND_LIMIT, 5]);
    expect(out.join("")).toBe("😀".repeat(SEND_LIMIT + 5));
  });
  it("分けたものをつなぐと元の文章に戻る", () => {
    const text = Array.from({ length: 3000 }, (_, i) => `${i}行目の文章です`).join("\n");
    expect(split(text).join("")).toBe(text);
  });
});

describe("calls：実際の文章分割数による利用回数", () => {
  it("空文字列でも1回", () => {
    expect(calls("")).toBe(1);
  });

  it("1万文字は1回、1万1文字は2回", () => {
    expect(calls("あ".repeat(SEND_LIMIT)))
      .toBe(1);

    expect(calls("あ".repeat(SEND_LIMIT + 1)))
      .toBe(2);
  });

  it("splitで分けた数と同じ", () => {
    const text = "あ".repeat(25000);

    expect(calls(text))
      .toBe(split(text).length);
  });
});
