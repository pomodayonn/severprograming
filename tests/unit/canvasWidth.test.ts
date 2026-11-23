// 単体テスト：canvasWidth（ノートに要る幅）
// 全画面で右のほうに置いた部品も、ふつうの画面で切れないように、ノートの幅を「いちばん右の部品の右はし＋24px」にする
import { describe, expect, it } from "vitest";
import { canvasWidth } from "../../src/lib/logic";

describe("canvasWidth：ノートに要る幅", () => {
  it("部品がなければ余白の24pxだけ", () => expect(canvasWidth([])).toBe(24));
  it("いちばん右はしの部品に合わせる", () => expect(canvasWidth([{ x: 20, width: 300 }, { x: 900, width: 420 }, { x: 400, width: 200 }])).toBe(1344));
  it("左にある大きい部品より、右にはみ出した小さい部品で決まる", () => expect(canvasWidth([{ x: 0, width: 800 }, { x: 790, width: 60 }])).toBe(874));
});
