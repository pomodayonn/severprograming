// 単体テスト：lib/rich.ts（ノートの文字の書式）
// 書式の JSON の読み書き、HTML への変換（エスケープ）、画面の中身からの読み戻し、決まった値以外を捨てることを確かめる
import { describe, expect, it } from "vitest";
import { clampPt, clearFmt, fromNodes, normalize, parseRich, stringifyRich, toHex, toHtml, toSize, type NodeLike } from "../../src/lib/rich";

// 画面の部品（DOM）の代わりの、普通のオブジェクト
const t = (s: string): NodeLike => ({ nodeType: 3, nodeName: "#text", textContent: s, childNodes: [] });
const el = (name: string, kids: NodeLike[], opt: { style?: NodeLike["style"]; attrs?: Record<string, string> } = {}): NodeLike => ({
  nodeType: 1, nodeName: name, childNodes: kids, style: opt.style ?? {},
  textContent: kids.map(k => k.textContent ?? "").join(""), getAttribute: n => opt.attrs?.[n] ?? null,
});

describe("normalize：書式のかたまりを整える", () => {
  it("となりの同じ書式はつなげる", () => expect(normalize([{ s: 0, e: 2, b: true }, { s: 2, e: 4, b: true }], 10)).toEqual([{ s: 0, e: 4, b: true }]));
  it("文字の長さをこえた分は切る", () => expect(normalize([{ s: 3, e: 99, i: true }], 5)).toEqual([{ s: 3, e: 5, i: true }]));
  it("重なったら前を優先する", () => expect(normalize([{ s: 0, e: 4, b: true }, { s: 2, e: 6, u: true }], 10)).toEqual([{ s: 0, e: 4, b: true }, { s: 4, e: 6, u: true }]));
  it("書式のないかたまりは消す", () => expect(normalize([{ s: 0, e: 3 }], 10)).toEqual([]));
});

describe("parseRich・stringifyRich：保存する JSON", () => {
  it("書き出して読み直すと同じ", () => {
    const r = { align: "center" as const, runs: [{ s: 0, e: 3, b: true, c: "#cf3f5b" }] };
    expect(parseRich(stringifyRich(r, 5), 5)).toEqual(r);
  });
  it("書式が何もなければ空の文字", () => expect(stringifyRich({ align: "left", runs: [] }, 5)).toBe(""));
  it("壊れた JSON は書式なし", () => expect(parseRich("{こわれた", 5)).toEqual({ runs: [] }));
  it("決まっていない色・文字の種類・大きさは捨てる（変な CSS を入れさせない）", () =>
    expect(parseRich(JSON.stringify({ runs: [{ s: 0, e: 2, c: "red;position:fixed", f: "comic", z: "999px", u: true }] }), 5).runs).toEqual([{ s: 0, e: 2, u: true }]));
});

describe("toHtml：画面に出す HTML", () => {
  it("文字は HTML として読まれないようにエスケープする", () => expect(toHtml("<b>&", { runs: [] })).toBe("&lt;b&gt;&amp;"));
  it("改行は <br>", () => expect(toHtml("あ\nい", { runs: [] })).toBe("あ<br>い"));
  it("書式のある所だけ span で包む", () => expect(toHtml("光合成", { runs: [{ s: 0, e: 2, b: true }] })).toBe('<span style="font-weight:700">光合</span>成'));
});

describe("fromNodes：画面の中身から読み戻す", () => {
  it("toHtml で作った形（span の style）を読み戻せる", () => {
    const root = el("DIV", [el("SPAN", [t("光合")], { style: { fontWeight: "700", color: "rgb(207, 63, 91)" } }), t("成")]);
    expect(fromNodes(root)).toEqual({ text: "光合成", runs: [{ s: 0, e: 2, b: true, c: "#cf3f5b" }] });
  });
  it("ブラウザが作る <b> <i> <u> と style を読む", () => {
    const root = el("DIV", [el("B", [t("太")]), el("I", [t("斜")]), el("U", [t("下")]), el("SPAN", [t("赤")], { style: { color: "rgb(207, 63, 91)", fontSize: "x-large" } })]);
    expect(fromNodes(root).runs).toEqual([{ s: 0, e: 1, b: true }, { s: 1, e: 2, i: true }, { s: 2, e: 3, u: true }, { s: 3, e: 4, c: "#cf3f5b", z: 18 }]);
  });
  it("<br> は改行、最後の <br> は数えない", () => expect(fromNodes(el("DIV", [t("あ"), el("BR", []), t("い"), el("BR", [])])).text).toBe("あ\nい"));
  it("Enter で入る <div> は1行。<div><br></div> は空の1行", () =>
    expect(fromNodes(el("DIV", [t("一"), el("DIV", [t("二")]), el("DIV", [el("BR", [])]), el("DIV", [t("四")])])).text).toBe("一\n二\n\n四"));
});

describe("toHex・toSize：ブラウザの書き方を読む", () => {
  it("rgb を #rrggbb に", () => expect(toHex("rgb(255, 0, 16)")).toBe("#ff0010"));
  it("透明は色なし", () => expect(toHex("rgba(0, 0, 0, 0)")).toBeUndefined());
  it("大きさの言葉・pt・px を pt にする", () => { expect(toSize("x-large")).toBe(18); expect(toSize("14pt")).toBe(14); expect(toSize("16px")).toBe(12); });
});

describe("文字の大きさ（ポイント）", () => {
  it("0.5pt きざみにする", () => expect(clampPt(10.7)).toBe(10.5));
  it("6〜96pt に収める", () => { expect(clampPt(2)).toBe(6); expect(clampPt(200)).toBe(96); });
  it("数でなければ undefined", () => expect(clampPt("おおきい")).toBeUndefined());
  it("pt で CSS にする", () => expect(toHtml("あ", { runs: [{ s: 0, e: 1, z: 14 }] })).toBe('<span style="font-size:14pt">あ</span>'));
  it("前の「小・中・大・特大」で保存したものは pt に読みかえる", () =>
    expect(parseRich(JSON.stringify({ runs: [{ s: 0, e: 1, z: "s" }, { s: 1, e: 2, z: "l" }, { s: 2, e: 3, z: "xl" }] }), 3).runs.map(r => r.z)).toEqual([9, 15, 19.5]));
});

describe("clearFmt：選んだ範囲の書式を消す（マーカーを消す・書式を消す）", () => {
  const runs = [{ s: 0, e: 6, b: true, bg: "#fff3a3" }];
  it("マーカーだけ消すと、太字は残る", () => expect(clearFmt(runs, 2, 4, ["bg"])).toEqual([{ s: 0, e: 2, b: true, bg: "#fff3a3" }, { s: 2, e: 4, b: true }, { s: 4, e: 6, b: true, bg: "#fff3a3" }]));
  it("全部消すと、範囲の外だけ残る", () => expect(clearFmt(runs, 2, 4)).toEqual([{ s: 0, e: 2, b: true, bg: "#fff3a3" }, { s: 4, e: 6, b: true, bg: "#fff3a3" }]));
  it("範囲の外の書式は変えない", () => expect(clearFmt([{ s: 0, e: 2, u: true }, { s: 5, e: 8, bg: "#d6e8ff" }], 0, 2, ["bg"])).toEqual([{ s: 0, e: 2, u: true }, { s: 5, e: 8, bg: "#d6e8ff" }]));
  it("ブラウザが透明のマーカーにした所は、マーカーなしと読む", () => {
    const span = (kids: NodeLike[], style: NodeLike["style"]) => el("SPAN", kids, { style });
    expect(fromNodes(el("DIV", [span([t("あ"), span([t("い")], { backgroundColor: "transparent" })], { backgroundColor: "rgb(255, 243, 163)" })])).runs).toEqual([{ s: 0, e: 1, bg: "#fff3a3" }]);
  });
});

