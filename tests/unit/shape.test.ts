// 単体テスト：NotePart.shapeOf・shapePatch（図形の形）
// 図形の形はshapeに保存する。以前のtextに保存したデータも読み取れるようにする
import { describe, expect, it } from "vitest";
import { NotePart } from "../../src/beans/NotePart";
import { PartType } from "../../src/enums/PartType";

const shape = (text: string) => new NotePart({ partType: PartType.SHAPE, text });

describe("shapeOf：図形の形を読む", () => {
  it("\"ellipse\" なら丸", () => expect(NotePart.shapeOf(shape("ellipse"))).toBe("ellipse"));
  it("\"rect\" なら四角", () => expect(NotePart.shapeOf(shape("rect"))).toBe("rect"));
  it("空や知らない値なら四角", () => expect(NotePart.shapeOf(shape(""))).toBe("rect"));
});

describe("shapePatch：図形の形を変える", () => {
  it("丸に変える値", () => expect(NotePart.shapePatch("ellipse")).toEqual({ shape: "ellipse" }));
  it("変えたあと shapeOf で読むと同じ形", () => {
    const p = new NotePart({ ...shape("rect"), ...NotePart.shapePatch("ellipse") });
    expect(NotePart.shapeOf(p)).toBe("ellipse");
  });
});
