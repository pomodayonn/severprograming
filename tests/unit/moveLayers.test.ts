// 単体テスト：moveLayers（いくつか選んだ部品の重なり順をまとめて変える）
// 選んだ部品どうしの順番は変えずに、いちばん前（最後）か、いちばん後ろ（最初）に動かすことを確かめる
import { describe, expect, it } from "vitest";
import { moveLayers } from "../../src/lib/logic";
import { NotePart } from "../../src/beans/NotePart";

const parts = ["a", "b", "c", "d"].map(id => new NotePart({ partId: id }));
const ids = (ps: NotePart[]) => ps.map(p => p.partId).join("");

describe("moveLayers：まとめて前面へ・背面へ", () => {
  it("前面へ：選んだ部品を最後に（順番はそのまま）", () => expect(ids(moveLayers(parts, ["c", "a"], "front"))).toBe("bdac"));
  it("背面へ：選んだ部品を最初に（順番はそのまま）", () => expect(ids(moveLayers(parts, ["d", "b"], "back"))).toBe("bdac"));
  it("1つだけでも使える", () => expect(ids(moveLayers(parts, ["a"], "front"))).toBe("bcda"));
  it("何も選んでいなければ変えない", () => expect(ids(moveLayers(parts, [], "front"))).toBe("abcd"));
});
