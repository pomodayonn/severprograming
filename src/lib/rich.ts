// ノートの文字の書式（11/25）：文字ごとの 太字・斜体・下線・文字の色・マーカー・文字の種類・大きさ と、部品ごとのそろえ方
//
// 【このファイルで何が起きているか】
// 11/25 夕：文字の大きさを「小・中・大・特大」から、Word と同じポイント（pt）にした。前の「小〜特大」で保存したものは pt に読みかえる。
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
/** 文字の大きさの選択肢（ポイント。Word と同じ並び）。この間の数（6〜96pt、0.5pt きざみ）なら、手で打ってもよい */
export const PT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;
export const PT_MIN = 6, PT_MAX = 96;
/** 前の「小・中・大・特大」で保存した大きさ（px）。読むときに pt に直す */
const OLD_PX: Record<string, number> = { s: 12, m: 15, l: 20, xl: 26 };
/** pt を 0.5 きざみにして、6〜96pt に収める。数でなければ undefined */
export function clampPt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(PT_MAX, Math.max(PT_MIN, Math.round(n * 2) / 2));
}
export type Align = "left" | "center" | "right";

/** 書式の1かたまり（text の s 文字目から e 文字目の手前まで） */
export interface Run { s: number; e: number; b?: boolean; i?: boolean; u?: boolean; c?: string; bg?: string; f?: FontKey; z?: number }
export interface Rich { align?: Align; runs: Run[] }
/** 1文字分の書式（Run から s・e を除いたもの） */
export type Fmt = Omit<Run, "s" | "e">;

const HEX = /^#[0-9a-f]{6}$/i;
const isFont = (v: unknown): v is FontKey => typeof v === "string" && v in FONTS;

/** 書式の中の、決まった値だけを残す（それ以外は捨てる） */
export function cleanFmt(f: Partial<Record<keyof Fmt, unknown>>): Fmt {
  const o: Fmt = {};
  if (f.b === true) o.b = true;
  if (f.i === true) o.i = true;
  if (f.u === true) o.u = true;
  if (typeof f.c === "string" && HEX.test(f.c)) o.c = f.c.toLowerCase();
  if (typeof f.bg === "string" && HEX.test(f.bg)) o.bg = f.bg.toLowerCase();
  if (isFont(f.f) && f.f !== "sans") o.f = f.f; // ゴシックはふつうの文字なので書かない
  const z = typeof f.z === "string" && f.z in OLD_PX ? clampPt(OLD_PX[f.z] * 0.75) : clampPt(f.z); // 前の「小〜特大」は pt に直す
  if (z !== undefined) o.z = z;
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

/**
 * text の a〜b 文字目の書式を消す（11/25 夕）。keys を渡せば、その書式だけ（例：["bg"] でマーカーだけ）消す。渡さなければ全部消す。
 * ブラウザのコマンドではマーカーがきれいに消えないことがあるので、保存の形（runs）のほうを直して、画面を作り直す
 */
export function clearFmt(runs: readonly Run[], a: number, b: number, keys?: readonly (keyof Fmt)[]): Run[] {
  if (b <= a) return [...runs];
  const out: Run[] = [];
  for (const r of runs) {
    if (r.e <= a || r.s >= b) { out.push(r); continue; } // 消す範囲の外
    if (r.s < a) out.push({ ...r, e: a });               // 範囲の前の部分はそのまま
    const mid: Run = { ...r, s: Math.max(r.s, a), e: Math.min(r.e, b) };
    if (keys) { for (const k of keys) delete mid[k]; out.push(mid); }  // 決めた書式だけ消す
    if (r.e > b) out.push({ ...r, s: b });               // 範囲の後の部分はそのまま
  }
  return normalize(out, Infinity);
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
  if (f.z) css.push(`font-size:${f.z}pt`);
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
/** CSS の font-size（"12pt"・"20px"・"x-large"、<font size="5"> の数字）を pt にする */
export function toSize(v: string | undefined | null): number | undefined {
  if (!v) return undefined;
  const k: Record<string, number> = { "xx-small": 7, "x-small": 7.5, small: 10, medium: 12, large: 13.5, "x-large": 18, "xx-large": 24, "xxx-large": 36, "1": 7.5, "2": 10, "3": 12, "4": 13.5, "5": 18, "6": 24, "7": 36 };
  if (k[v] !== undefined) return k[v];
  const m = v.match(/^([\d.]+)(pt|px)$/); if (!m) return undefined;
  return clampPt(m[2] === "pt" ? Number(m[1]) : Number(m[1]) * 0.75);
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
export function fromNodes(root: NodeLike, opt: { keepLastBr?: boolean } = {}): { text: string; runs: Run[] } {
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
        else if (st.backgroundColor && /^(transparent|initial|rgba\(.*,\s*0\))$/.test(st.backgroundColor)) delete g.bg; // マーカーなし（11/25 夕）
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
  if (!opt.keepLastBr && last && last.nodeType === 1 && last.nodeName.toUpperCase() === "BR" && text.endsWith("\n")) text = text.slice(0, -1);
  return { text, runs: normalize(runs, text.length) };
}

// ---- 箇条書き・番号付きリスト（11/25 夜）----
// 箇条書きは、行の頭に「・ 」、番号付きは「1. 」「2. 」…を、ふつうの文字として入れる（AI・単語テスト・検索にもそのまま読める）。
// ボタンで付け外しでき、箇条書きの行で Enter を押すと、次の行にも同じ印（番号は次の数）が付く。印だけの行で Enter を押すと、箇条書きが終わる
export type ListKind = "ul" | "ol";
const LIST = /^(・ |\d{1,3}\. )/;
/** 行の頭の印の種類（なければ null） */
export function listOf(line: string): ListKind | null { const m = line.match(LIST); return m ? (m[1] === "・ " ? "ul" : "ol") : null; }

/** text の pos 文字目から del 文字を消して ins を入れる。書式（runs）も、ずれた分だけ動かす（入れた文字は書式なし） */
export function spliceRich(text: string, runs: readonly Run[], pos: number, del: number, ins: string): { text: string; runs: Run[] } {
  const d = ins.length - del, end = pos + del, out: Run[] = [];
  for (const r of runs) {
    if (r.e <= pos) { out.push(r); continue; }                         // 前はそのまま
    if (r.s >= end) { out.push({ ...r, s: r.s + d, e: r.e + d }); continue; } // 後ろはずらす
    if (r.s < pos) out.push({ ...r, e: pos });                         // 消す所の前の部分
    if (r.e > end) out.push({ ...r, s: pos + ins.length, e: r.e + d }); // 消す所の後の部分
  }
  const t = text.slice(0, pos) + ins + text.slice(end);
  return { text: t, runs: normalize(out, t.length) };
}
/** 行の始まりの位置の一覧 */
const lineStarts = (text: string) => { const a = [0]; for (let i = 0; i < text.length; i++) if (text[i] === "\n") a.push(i + 1); return a; };

/**
 * a〜b 文字目にかかる行に、箇条書き（ul）か番号（ol）を付ける。全部の行がもうその印なら、外す。
 * 返す sel は、同じ行を選び直すための範囲
 */
export function toggleList(text: string, runs: readonly Run[], a: number, b: number, kind: ListKind): { text: string; runs: Run[]; sel: [number, number] } {
  const starts = lineStarts(text), first = Math.max(0, starts.filter(s => s <= a).length - 1), last = Math.max(first, starts.filter(s => s <= Math.max(a, b - (b > a && text[b - 1] === "\n" ? 1 : 0))).length - 1);
  const lines = text.split("\n"), off = lines.slice(first, last + 1).every(l => listOf(l) === kind);
  let t = text, rs: Run[] = [...runs], shift = 0, n = 0;
  for (let i = first; i <= last; i++) {
    const pos = starts[i] + shift, m = lines[i].match(LIST), oldLen = m ? m[1].length : 0;
    const ins = off ? "" : kind === "ul" ? "・ " : `${++n}. `;
    ({ text: t, runs: rs } = spliceRich(t, rs, pos, oldLen, ins));
    shift += ins.length - oldLen;
  }
  const s2 = lineStarts(t), endLine = last + 1 < s2.length ? s2[last + 1] - 1 : t.length;
  return { text: t, runs: rs, sel: [s2[first], endLine] };
}
/**
 * 箇条書きの行で Enter を押したときの形。箇条書きでない行なら null（ふつうの改行にする）。
 * 印だけの行なら印を消して箇条書きを終わる。そうでなければ、改行と次の印（番号は次の数）を入れる。caret は、その後のカーソルの位置
 */
export function continueList(text: string, runs: readonly Run[], pos: number): { text: string; runs: Run[]; caret: number } | null {
  const ls = text.lastIndexOf("\n", pos - 1) + 1, le = text.indexOf("\n", pos) < 0 ? text.length : text.indexOf("\n", pos);
  const line = text.slice(ls, le), m = line.match(LIST); if (!m) return null;
  if (pos - ls < m[1].length) return null; // 印の途中なら、ふつうの改行
  if (line.length === m[1].length) { const r = spliceRich(text, runs, ls, m[1].length, ""); return { ...r, caret: ls }; } // 印だけ：終わる
  const next = m[1] === "・ " ? "・ " : `${parseInt(m[1], 10) + 1}. `;
  const r = spliceRich(text, runs, pos, 0, "\n" + next);
  return { ...r, caret: pos + 1 + next.length };
}

