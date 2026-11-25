// ノートの文字の書式（11/25）：文字ごとの 太字・斜体・下線・文字の色・マーカー・文字の種類・大きさ と、部品ごとのそろえ方
//
// 【このファイルで何が起きているか】
// 文字そのものは今までどおり NotePart.text に「書式なしの文字」で入れる（AIのまとめ・単語テスト・検索はそのまま使える）。
// 書式は NotePart.style に JSON の文字列で入れる。形は { align, runs: [{ s, e, b, i, u, c, bg, f, z }] }。
//   s〜e は text の何文字目から何文字目まで（e は含まない）。b 太字・i 斜体・u 下線・c 文字の色・bg マーカーの色・f 文字の種類・z 大きさ
// ・toHtml   ：text と書式から、画面に出す HTML を作る（文字はエスケープするので、HTML として読まれることはない）
// ・fromNodes：書き終わった画面（contenteditable）の中身から、text と書式を読み戻す
// ・parseRich：保存されていた JSON を読む。決まった値（色は #rrggbb、文字の種類・大きさは下の一覧）以外は捨てる（変な CSS を入れさせない）
// 画面やデータベースには関係しない、ただの計算（同じ入力なら必ず同じ答え）

/** 文字の種類（画面の選択肢の名前と、CSS の font-family） */
export const FONTS = {
  sans: { n: "ゴシック", css: '"Zen Maru Gothic","Hiragino Sans","Yu Gothic",sans-serif' },
  serif: { n: "明朝", css: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif' },
  mono: { n: "等幅", css: 'ui-monospace,"Cascadia Mono",Consolas,monospace' },
} as const;
export type FontKey = keyof typeof FONTS;
/** 文字の大きさ（画面の選択肢の名前と、px） */
export const SIZES = { s: { n: "小", px: 12 }, m: { n: "中", px: 15 }, l: { n: "大", px: 20 }, xl: { n: "特大", px: 26 } } as const;
export type SizeKey = keyof typeof SIZES;
export type Align = "left" | "center" | "right";

/** 書式の1かたまり（text の s 文字目から e 文字目の手前まで） */
export interface Run { s: number; e: number; b?: boolean; i?: boolean; u?: boolean; c?: string; bg?: string; f?: FontKey; z?: SizeKey }
export interface Rich { align?: Align; runs: Run[] }
/** 1文字分の書式（Run から s・e を除いたもの） */
export type Fmt = Omit<Run, "s" | "e">;

const HEX = /^#[0-9a-f]{6}$/i;
const isFont = (v: unknown): v is FontKey => typeof v === "string" && v in FONTS;
const isSize = (v: unknown): v is SizeKey => typeof v === "string" && v in SIZES;

/** 書式の中の、決まった値だけを残す（それ以外は捨てる） */
export function cleanFmt(f: Partial<Record<keyof Fmt, unknown>>): Fmt {
  const o: Fmt = {};
  if (f.b === true) o.b = true;
  if (f.i === true) o.i = true;
  if (f.u === true) o.u = true;
  if (typeof f.c === "string" && HEX.test(f.c)) o.c = f.c.toLowerCase();
  if (typeof f.bg === "string" && HEX.test(f.bg)) o.bg = f.bg.toLowerCase();
  if (isFont(f.f) && f.f !== "sans") o.f = f.f; // ゴシックはふつうの文字なので書かない
  if (isSize(f.z) && f.z !== "m") o.z = f.z; // 中はふつうの大きさなので書かない
  return o;
}
const same = (a: Fmt, b: Fmt) => a.b === b.b && a.i === b.i && a.u === b.u && a.c === b.c && a.bg === b.bg && a.f === b.f && a.z === b.z;
const empty = (f: Fmt) => !f.b && !f.i && !f.u && !f.c && !f.bg && !f.f && !f.z;

/** runs を、text の長さに収めて、重なり・空・書式なしを消し、となりの同じ書式をつなげる */
export function normalize(runs: readonly Run[], length: number): Run[] {
  const out: Run[] = [];
  const sorted = [...runs].map(r => ({ ...cleanFmt(r), s: Math.max(0, Math.floor(r.s)), e: Math.min(length, Math.floor(r.e)) })).sort((a, b) => a.s - b.s);
  for (const r of sorted) {
    const s = Math.max(r.s, out.length ? out[out.length - 1].e : 0); // 前と重なっていたら、前を優先する
    if (r.e <= s || empty(r)) continue;
    const last = out[out.length - 1];
    if (last && last.e === s && same(last, r)) last.e = r.e; else out.push({ ...r, s });
  }
  return out;
}

/** 保存されている JSON を読む。読めなければ書式なし */
export function parseRich(json: string | null | undefined, length = Infinity): Rich {
  if (!json) return { runs: [] };
  try {
    const v = JSON.parse(json) as { align?: unknown; runs?: unknown };
    const runs = Array.isArray(v.runs) ? (v.runs as Run[]).filter(r => r && Number.isFinite(r.s) && Number.isFinite(r.e)) : [];
    const align = v.align === "center" || v.align === "right" ? v.align : undefined;
    return { ...(align ? { align } : {}), runs: normalize(runs, length) };
  } catch { return { runs: [] }; }
}
/** 書式を JSON にする。書式が何もなければ ""（Neon にも空で送る） */
export function stringifyRich(r: Rich, length: number): string {
  const runs = normalize(r.runs, length);
  if (!runs.length && (!r.align || r.align === "left")) return "";
  return JSON.stringify({ ...(r.align && r.align !== "left" ? { align: r.align } : {}), runs });
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 1つの書式を CSS（style 属性の中身）にする */
export function fmtCss(f: Fmt): string {
  const css: string[] = [];
  if (f.b) css.push("font-weight:700");
  if (f.i) css.push("font-style:italic");
  if (f.u) css.push("text-decoration:underline");
  if (f.c) css.push(`color:${f.c}`);
  if (f.bg) css.push(`background-color:${f.bg}`);
  if (f.f) css.push(`font-family:${FONTS[f.f].css.replace(/"/g, "'")}`);
  if (f.z) css.push(`font-size:${SIZES[f.z].px}px`);
  return css.join(";");
}
/** text と書式から HTML を作る。書式のある所は <span style="…">、改行は <br>（読み戻すときは style を読む） */
export function toHtml(text: string, rich: Rich): string {
  const runs = normalize(rich.runs, text.length);
  const piece = (t: string) => esc(t).replace(/\n/g, "<br>");
  let html = "", at = 0;
  for (const r of runs) {
    html += piece(text.slice(at, r.s));
    const { s, e, ...f } = r;
    html += `<span style="${fmtCss(f)}">${piece(text.slice(s, e))}</span>`;
    at = e;
  }
  html += piece(text.slice(at));
  // 最後が改行のときは、ブラウザが最後の行を出さないので <br> をもう1つ足す
  return text.endsWith("\n") ? html + "<br>" : html;
}

/** 読み戻しに使う、画面の部品（DOM）の最小限の形。テストでは、この形の普通のオブジェクトを使う */
export interface NodeLike {
  nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
  style?: { fontWeight?: string; fontStyle?: string; textDecoration?: string; textDecorationLine?: string; color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string };
}
/** "rgb(1, 2, 3)" や "#abc" を "#rrggbb" にする。読めなければ undefined */
export function toHex(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);
  if (m) { if (m[4] !== undefined && Number(m[4]) === 0) return undefined; return "#" + [m[1], m[2], m[3]].map(x => Number(x).toString(16).padStart(2, "0")).join(""); }
  if (/^#[0-9a-f]{3}$/i.test(v)) return "#" + [...v.slice(1)].map(c => c + c).join("").toLowerCase();
  return HEX.test(v) ? v.toLowerCase() : undefined;
}
/** CSS の font-size（"20px" や "x-large"、<font size="5"> の数字）を大きさの名前にする */
export function toSize(v: string | undefined | null): SizeKey | undefined {
  if (!v) return undefined;
  const k: Record<string, SizeKey> = { "x-small": "s", small: "s", "1": "s", "2": "s", medium: "m", "3": "m", large: "l", "x-large": "l", "4": "l", "5": "l", "xx-large": "xl", "xxx-large": "xl", "6": "xl", "7": "xl" };
  if (k[v]) return k[v];
  const px = parseFloat(v); if (!Number.isFinite(px)) return undefined;
  return px < 13.5 ? "s" : px < 17.5 ? "m" : px < 23 ? "l" : "xl";
}
/** CSS の font-family から文字の種類を見分ける */
export function toFont(v: string | undefined | null): FontKey | undefined {
  if (!v) return undefined;
  const f = v.toLowerCase();
  if (/mincho|明朝|serif/.test(f) && !/sans-serif/.test(f)) return "serif";
  if (/mono|consolas|courier/.test(f)) return "mono";
  if (/gothic|ゴシック|sans/.test(f)) return "sans";
  return undefined;
}
const BLOCK = /^(DIV|P|LI|H[1-6])$/;

/** 画面（contenteditable）の中身から、text と書式を読み戻す。ブラウザが作る <b> <i> <u> <font> <span style> <div> <br> を読む */
export function fromNodes(root: NodeLike): { text: string; runs: Run[] } {
  let text = "", pending = false; // pending：<div> が終わったところ。次に文字か <div> が来たら、改行を1つ入れる
  const runs: Run[] = [];
  const flush = () => { if (pending) { text += "\n"; pending = false; } };
  const walk = (node: NodeLike, f: Fmt) => {
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType === 3) { // 文字
        const t = (ch.textContent ?? "").replace(/ /g, " ").replace(/​/g, "");
        if (t) { flush(); if (!empty(f)) runs.push({ ...f, s: text.length, e: text.length + t.length }); text += t; }
        continue;
      }
      if (ch.nodeType !== 1) continue;
      const name = ch.nodeName.toUpperCase();
      if (name === "BR") {
        // <div><br></div> は「空の1行」。改行は <div> のところで入れたので、<br> は数えない
        if (BLOCK.test(node.nodeName.toUpperCase()) && node.childNodes.length === 1 && !node.textContent) continue;
        flush(); text += "\n"; continue;
      }
      const g: Fmt = { ...f };
      if (name === "B" || name === "STRONG") g.b = true;
      if (name === "I" || name === "EM") g.i = true;
      if (name === "U") g.u = true;
      if (name === "FONT") {
        const c = toHex(ch.getAttribute?.("color")); if (c) g.c = c;
        const z = toSize(ch.getAttribute?.("size")); if (z) g.z = z;
        const fo = toFont(ch.getAttribute?.("face")); if (fo) g.f = fo;
      }
      const st = ch.style;
      if (st) {
        if (st.fontWeight) { const w = st.fontWeight; if (w === "bold" || Number(w) >= 600) g.b = true; else if (w === "normal" || Number(w) < 600) delete g.b; }
        if (st.fontStyle) { if (st.fontStyle === "italic") g.i = true; else if (st.fontStyle === "normal") delete g.i; }
        const deco = st.textDecorationLine || st.textDecoration;
        if (deco) { if (deco.includes("underline")) g.u = true; else if (deco === "none") delete g.u; }
        const c = toHex(st.color); if (c) g.c = c;
        const bg = toHex(st.backgroundColor); if (bg) g.bg = bg;
        const fo = toFont(st.fontFamily); if (fo) g.f = fo;
        const z = toSize(st.fontSize); if (z) g.z = z;
      }
      // <div> や <p> は1行。前に文字があって改行で終わっていなければ、改行を入れてから中に入る
      const block = BLOCK.test(name);
      if (block) { if (text && !text.endsWith("\n")) { text += "\n"; pending = false; } else flush(); }
      walk(ch, cleanFmt(g));
      if (block) pending = true;
    }
  };
  walk(root, {});
  // いちばん最後の <br> は、最後の行を見せるためにブラウザ（と toHtml）が足したものなので、改行に数えない
  const kids = Array.from(root.childNodes), last = kids[kids.length - 1];
  if (last && last.nodeType === 1 && last.nodeName.toUpperCase() === "BR" && text.endsWith("\n")) text = text.slice(0, -1);
  return { text, runs: normalize(runs, text.length) };
}
