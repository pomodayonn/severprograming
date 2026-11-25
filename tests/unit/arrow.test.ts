// 単体テスト：arrowPoints・arrowFromPoints（矢印の向き）
// 矢印の2つの点を text に入れて読み戻せるか、点を動かすと部品の位置と大きさが点を囲むように変わるか、古い矢印が今までどおり左→右になるか
import { describe, expect, it } from "vitest";
import { ARROW_PAD, ARROW_TOP, arrowFromPoints, arrowPoints, newPart } from "../../src/lib/logic";
import { PartType } from "../../src/enums/PartType";

/** 部品の左上と、中の点から、ノートの上の点に直す */
const abs = (a: ReturnType<typeof arrowFromPoints>) => { const p = arrowPoints(a); return [a.x + p.x1, a.y + p.y1, a.x + p.x2, a.y + p.y2]; };

describe("arrowFromPoints・arrowPoints：矢印の2つの点", () => {
  it("右下向き：作った点がそのまま読み戻せる", () => expect(abs(arrowFromPoints(100, 200, 300, 260))).toEqual([100, 200, 300, 260]));
  it("左上向き（先の点が始まりより左上）でも読み戻せる", () => expect(abs(arrowFromPoints(300, 260, 100, 200))).toEqual([300, 260, 100, 200]));
  it("真下向き：幅が足りなくても 60px にする", () => { const a = arrowFromPoints(150, 100, 150, 300); expect(a.width).toBe(60); expect(abs(a)).toEqual([150, 100, 150, 300]); });
  it("部品は、点のまわりに余白と上の帯の分だけ広い", () => { const a = arrowFromPoints(100, 200, 300, 260); expect([a.x, a.y]).toEqual([100 - ARROW_PAD, 200 - ARROW_PAD - ARROW_TOP]); });
  it("ノートの左・上の外には出さない", () => { const a = arrowFromPoints(-50, -50, 100, 100); expect(a.x).toBe(0); expect(a.y).toBe(0); });
  it("text が空の古い矢印は、左から右へ（まん中の高さ）", () => expect(arrowPoints({ width: 160, height: 30, text: "" })).toEqual({ x1: 4, y1: 27, x2: 158, y2: 27 }));
  it("新しく置く矢印は、渡した高さに、左から右への向きで置く", () => {
    const p = newPart(PartType.ARROW, 250), q = arrowPoints(p);
    expect(p.y).toBe(250); expect(q.y1).toBe(q.y2); expect(q.x2 > q.x1).toBe(true);
  });
});
