// 単体テスト：copyPart・moveLayer（部品の複製と重なり順）
// 複製は新しいIDで、元の部品と単語を変えないこと。重なり順は、あとの部品ほど前に描かれること
import { describe, expect, it } from "vitest";
import { copyPart, moveLayer } from "../../src/lib/logic";
import { NotePart } from "../../src/beans/NotePart";
import { Word } from "../../src/beans/Word";

const src = new NotePart({ partId: "p1", x: 10, y: 20, text: "光合成", style: '{"runs":[{"s":0,"e":2,"b":true}]}', words: [new Word({ wordId: "w1", partId: "p1", term: "気孔" })] });

describe("copyPart：部品の複製", () => {
  const c = copyPart(src);
  it("新しいIDになる", () => expect(c.partId === "p1").toBe(false));
  it("右下に24pxずれる", () => expect([c.x, c.y]).toEqual([34, 44]));
  it("文字と書式はそのまま", () => expect([c.text, c.style]).toEqual([src.text, src.style]));
  it("単語も新しいIDで、新しい部品のものになる", () => { expect(c.words[0].wordId === "w1").toBe(false); expect(c.words[0].partId).toBe(c.partId); expect(c.words[0].term).toBe("気孔"); });
  it("元の部品は変えない", () => expect([src.partId, src.words[0].wordId]).toEqual(["p1", "w1"]));
});

describe("moveLayer：重なり順", () => {
  const parts = ["a", "b", "c"].map(id => new NotePart({ partId: id }));
  const ids = (ps: NotePart[]) => ps.map(p => p.partId).join("");
  it("前面へ：いちばん最後にする", () => expect(ids(moveLayer(parts, "a", "front"))).toBe("bca"));
  it("背面へ：いちばん最初にする", () => expect(ids(moveLayer(parts, "c", "back"))).toBe("cab"));
  it("ない部品なら変えない", () => expect(ids(moveLayer(parts, "z", "front"))).toBe("abc"));
});
