// ノートのキャンバス：枠・文字・図形・矢印を置いて、動かす・大きさを変える・色を変える
// 1つの部品を動かしても、ほかの部品は描き直さない（PartView を memo）。ドラッグは1フレームに1回だけ反映する。
// 11/12：部品が大きくなったら（大きさの変更・単語の追加・文字があふれたとき）、NoteManager.adjustOverlap で下の部品をずらす（A）
//
// 【このファイルで何が起きているか】
// ノートを書く白い紙の部分です。部品（枠・文字・図形・矢印）を置いて、つかんで動かしたり、右下をつかんで大きさを変えたりする。
// ・PartView：部品1つを描く。中の文字を変えたら h.upd で知らせる
// ・NoteCanvas：部品を並べて、ドラッグ（動かす・大きさを変える）を処理する
// 変えた結果は onChange で Study.tsx に渡し、Study.tsx が下書き（drafts）に入れる。ここでは保存しない
// 11/21 道B：部品は画面用の形（El）ではなく、beans の NotePart をそのまま使う。
//   名前の対応：kind → partType（PartType）、ft → frameType、w・h → width・height、head → headingLevel、at → updatedAt
//   部品を変えたら、新しい NotePart を作って updatedAt を今の時刻にする（同期でその部品が送られる）
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FrameType } from "../types";
import { NotePart, type ShapeKind } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { now } from "../beans/DateTime";
import { PartType } from "../enums/PartType";
import { ARROW_W, arrowFromPoints, arrowPoints, arrowStyleOf, withArrowStyle, canvasWidth, copyPart, findInParts, FT, moveLayers, newWord, stepZoom, type FindHit } from "../lib/logic";
import { FONTS, PT_MAX, PT_MIN, PT_SIZES, clampPt, clearFmt, continueList, toggleList, fromNodes, parseRich, stringifyRich, toHtml, type Align, type FontKey, type Rich } from "../lib/rich";
import { controller } from "../controller/Controller";

/** 部品の種類ごとの名前（部品の上に出す） */
const LABEL: Record<PartType, string> = { [PartType.FRAME]: "枠", [PartType.TEXT]: "文字", [PartType.SHAPE]: "図形", [PartType.ARROW]: "矢印" };
/** 部品の見た目の class 名（index.css の .el.frame など） */
const CLS: Record<PartType, string> = { [PartType.FRAME]: "frame", [PartType.TEXT]: "text", [PartType.SHAPE]: "shape", [PartType.ARROW]: "arrow" };

/** partId の部品が old より高くなっていたら、下の部品をずらす（保存はしない。ノートの下書きを変えるだけ） */
const grow = (parts: NotePart[], partId: string, old: number): NotePart[] => {
  const p = parts.find(x => x.partId === partId);
  return p && p.height > old ? controller.adjustNoteParts(parts, partId) : parts;
};

type Mode = "move" | "size" | "p1" | "p2"; // p1・p2：矢印の始まり・先の点を動かす（11/25 夕）
interface Handlers {
  upd: (partId: string, patch: Partial<NotePart>) => void;
  remove: (partId: string) => void;
  start: (e: React.PointerEvent, part: NotePart, mode: Mode) => void;
  /** 部品を選ぶ（11/25。書式のボタン・複製・重なり順は、選んでいる部品に効く） */
  select: (partId: string, add?: boolean) => void; // add：Shift・Ctrl を押しながら（選んでいる部品に足す・外す。11/25 夜）
}

/**
 * 書式つきで書ける欄（11/25。前は textarea で、文字しか書けなかった）。
 * 文字は part.text（書式なし）、書式は part.style（JSON）に入れる。形は lib/rich.ts。
 * 中身はブラウザ（contentEditable）が書きかえるので、こちらから HTML を入れ直すのは、外から text・style が変わったとき
 * （元に戻す・AIのまとめ・別の端末から受け取ったとき）だけ。自分で書いた分は last に覚えておき、入れ直さない（カーソルが飛ばないように）
 */
const RichText = memo(function RichText({ part: p, h, placeholder }: { part: NotePart; h: Handlers; placeholder: string }) {
  const ref = useRef<HTMLDivElement>(null), last = useRef<{ text: string; style: string } | null>(null);
  const cur = useRef(p); cur.current = p;
  const keepSel = useRef<[number, number] | null>(null); // 書式を直したあと、画面を作り直してから選び直す範囲（文字数）
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (last.current && last.current.text === p.text && last.current.style === p.style) return;
    el.innerHTML = toHtml(p.text, parseRich(p.style, p.text.length));
    last.current = { text: p.text, style: p.style };
    if (keepSel.current) { selectChars(el, ...keepSel.current); keepSel.current = null; }
  }, [p.text, p.style]);
  // 11/25 夕：書式のボタン（マーカーを消す・書式を消す）から、選んだ範囲の書式を保存の形のほうで直せるようにする
  useEffect(() => {
    const el = ref.current; if (!el) return;
    editors.set(el, fn => {
      const q = cur.current, r = savedRange; if (!r || !el.contains(r.startContainer)) return;
      const a = charsBefore(el, r.startContainer, r.startOffset), b = charsBefore(el, r.endContainer, r.endOffset);
      const res = fn(q.text, parseRich(q.style, q.text.length), Math.min(a, b), Math.max(a, b)), text = res.text ?? q.text;
      const style = stringifyRich(res.rich, text.length);
      if (style === q.style && text === q.text) return;
      keepSel.current = res.sel ?? [Math.min(a, b), Math.max(a, b)];
      h.upd(q.partId, { text, style });
    });
    return () => { editors.delete(el); };
  }, [h]);
  const onInput = () => {
    const el = ref.current; if (!el) return;
    const q = cur.current, { text, runs } = fromNodes(el);
    const style = stringifyRich({ align: parseRich(q.style).align, runs }, text.length);
    last.current = { text, style };
    if (text === q.text && style === q.style) return;
    // 文字があふれたら、あふれた分だけ部品を高くする（下の部品は grow でずらす）
    const over = el.scrollHeight - el.clientHeight;
    h.upd(q.partId, over > 0 ? { text, style, height: q.height + over } : { text, style });
  };
  const align = parseRich(p.style).align ?? "left";
  return <div ref={ref} className={`rt-edit h${p.headingLevel}`} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={placeholder}
    data-ph={placeholder} style={{ textAlign: align }} onInput={onInput} onFocus={() => h.select(p.partId)}
    onKeyDown={e => {
      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
      e.preventDefault();
      // 11/25 夜：箇条書き・番号の行なら、次の行にも印を付ける（印だけの行なら箇条書きを終わる）
      const el = ref.current, s = document.getSelection(), q = cur.current;
      if (el && s && s.rangeCount && s.isCollapsed && el.contains(s.anchorNode)) {
        const pos = charsBefore(el, s.anchorNode!, s.anchorOffset), rich = parseRich(q.style, q.text.length), r = continueList(q.text, rich.runs, pos);
        if (r) { keepSel.current = [r.caret, r.caret]; h.upd(q.partId, { text: r.text, style: stringifyRich({ ...rich, runs: r.runs }, r.text.length) }); return; }
      }
      document.execCommand("insertLineBreak");
    }}
    onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} />;
});

/** 書式つきの欄ごとの「選んだ範囲の書式を直す」関数（11/25 夕） */
type EditFn = (text: string, rich: Rich, a: number, b: number) => { text?: string; rich: Rich; sel?: [number, number] };
const editors = new WeakMap<HTMLElement, (fn: EditFn) => void>();
/** 欄の先頭から、その位置までの文字数（text の何文字目か）。lib/rich.ts の fromNodes と同じ数え方 */
function charsBefore(box: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange(); r.setStart(box, 0); r.setEnd(node, offset);
  return fromNodes(r.cloneContents() as unknown as Parameters<typeof fromNodes>[0], { keepLastBr: true }).text.length;
}
/** 作り直した欄（toHtml の形：文字・<span>・<br>）で、a〜b 文字目を選ぶ */
function selectChars(box: HTMLElement, a: number, b: number) {
  const r = rangeOfChars(box, a, b);
  box.focus(); const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(r);
}
/** 欄の a〜b 文字目を指す Range（選びはしない。検索の印にも使う） */
function rangeOfChars(box: HTMLElement, a: number, b: number): Range {
  const at = (pos: number): [Node, number] => {
    let n = 0; const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let x = w.nextNode(); x; x = w.nextNode()) {
      if (x.nodeType === 3) { const len = x.textContent?.length ?? 0; if (pos <= n + len) return [x, pos - n]; n += len; }
      else if (x.nodeName === "BR") { if (pos === n) return [x.parentNode!, Array.prototype.indexOf.call(x.parentNode!.childNodes, x)]; n += 1; }
    }
    return [box, box.childNodes.length];
  };
  const r = document.createRange(), [sn, so] = at(a), [en, eo] = at(b);
  r.setStart(sn, so); r.setEnd(en, eo);
  return r;
}
/** 今選んでいる欄の書式を、保存の形のほうで直す */
function editSel(fn: EditFn) {
  const r = savedRange, el = r && (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest(".rt-edit");
  if (el instanceof HTMLElement) editors.get(el)?.(fn);
}

/** 部品の枠（文字の外）を押したら、書いていた欄から出る（ドラッグはフォーカスを動かさないので、Ctrl＋C が文字のコピーのままになってしまう） */
function blurEditor(target: EventTarget) {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a.isContentEditable && !(target instanceof Element && target.closest(".rt-edit"))) a.blur();
}

/** 矢印（11/25 夕）：始まりの点から先の点へ。両はしの丸をドラッグすると、向きと長さが変わる */
function Arrow({ part: p, h }: { part: NotePart; h: Handlers }) {
  const { x1, y1, x2, y2 } = arrowPoints(p), len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const st = arrowStyleOf(p.text), w = ARROW_W[st.w]; // 11/25 夜：太さ（細い・ふつう・太い）と点線
  const hx = x2 - ux * w.len, hy = y2 - uy * w.len; // 矢じりの根もと
  const head = `${x2},${y2} ${hx - uy * w.half},${hy + ux * w.half} ${hx + uy * w.half},${hy - ux * w.half}`;
  return (<>
    <svg className="aw" width={p.width} height={p.height} aria-hidden="true"><line x1={x1} y1={y1} x2={hx} y2={hy} stroke={p.color} strokeWidth={w.line} strokeLinecap="round" strokeDasharray={st.dash ? `${w.line * 2.5} ${w.line * 2}` : undefined} /><polygon points={head} fill={p.color} /></svg>
    <span className="ah" style={{ left: x1, top: y1 }} onPointerDown={e => h.start(e, p, "p1")} title="ドラッグで始まりの位置を変える" />
    <span className="ah tip" style={{ left: x2, top: y2 }} onPointerDown={e => h.start(e, p, "p2")} title="ドラッグで矢印の向きと長さを変える" />
  </>);
}

const PartView = memo(function PartView({ part: p, h, sel }: { part: NotePart; h: Handlers; sel: boolean }) {
  const frame = p.partType === PartType.FRAME, text = p.partType === PartType.TEXT, shape = p.partType === PartType.SHAPE;
  const label = frame ? (FT[p.frameType as FrameType]?.n ?? LABEL[p.partType]) : LABEL[p.partType];
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const words = p.words, wordFrame = frame && p.frameType === "word";
  const setWord = (i: number, patch: Partial<Word>) => h.upd(p.partId, { words: words.map((w, j) => j === i ? new Word({ ...w, ...patch, updatedAt: now() }) : w) });
  return (
    <div data-id={p.partId} className={`el ${CLS[p.partType]}${sel ? " sel" : ""}`} onPointerDownCapture={e => { h.select(p.partId, e.shiftKey || e.ctrlKey || e.metaKey); blurEditor(e.target); }} style={{ left: p.x, top: p.y, width: p.width, height: p.height, borderColor: p.color, background: frame ? p.color + "14" : undefined, borderRadius: shape && NotePart.shapeOf(p) === "ellipse" ? "50%" : undefined }}>
      <div className="eh" style={{ color: p.color }} onPointerDown={e => h.start(e, p, "move")}>
        <span>{label}</span>
        {text && <select value={p.headingLevel} onPointerDown={stop} onChange={e => h.upd(p.partId, { headingLevel: Number(e.target.value) })}><option value={0}>本文</option><option value={1}>見出し1</option><option value={2}>見出し2</option><option value={3}>見出し3</option></select>}
        {p.partType === PartType.ARROW && (() => { const st = arrowStyleOf(p.text); return (<>
          <select value={st.w} onPointerDown={stop} onChange={e => h.upd(p.partId, { text: withArrowStyle(p.text, { w: e.target.value as keyof typeof ARROW_W }) })} aria-label="矢印の太さ" title="矢印の太さ">
            {(Object.keys(ARROW_W) as (keyof typeof ARROW_W)[]).map(k => <option key={k} value={k}>{ARROW_W[k].n}</option>)}</select>
          <button className={"dashb" + (st.dash ? " on" : "")} onPointerDown={stop} onClick={() => h.upd(p.partId, { text: withArrowStyle(p.text, { dash: !st.dash }) })} aria-pressed={st.dash} aria-label="点線" title="点線にする・実線に戻す">┄</button></>); })()}
        {shape && <select value={NotePart.shapeOf(p)} onPointerDown={stop} onChange={e => h.upd(p.partId, NotePart.shapePatch(e.target.value as ShapeKind))}><option value="rect">四角</option><option value="ellipse">丸</option></select>}
        <input type="color" value={p.color} onPointerDown={stop} onChange={e => h.upd(p.partId, { color: e.target.value })} aria-label="色" />
        <button onPointerDown={stop} onClick={() => h.remove(p.partId)} aria-label="削除">×</button>
      </div>
      {wordFrame && (
        <div className="wl">{words.map((w, i) => (
          <div className="wr" key={w.wordId}><input placeholder="用語" value={w.term} onChange={e => setWord(i, { term: e.target.value })} />
            <input placeholder="意味" value={w.meaning} onChange={e => setWord(i, { meaning: e.target.value })} />
            <button onClick={() => h.upd(p.partId, { words: words.filter((_, j) => j !== i) })} aria-label="この単語を消す">×</button></div>))}
          <button className="btn sm" onClick={() => h.upd(p.partId, { words: [...words, newWord(p.partId)], height: p.height + 28 })}>＋ 単語</button></div>)}
      {(text || (frame && !wordFrame)) && <RichText part={p} h={h} placeholder={text ? "文字を入力" : "ここに書く"} />}
      {p.partType === PartType.ARROW && <Arrow part={p} h={h} />}
      {p.partType !== PartType.ARROW && <span className="rs" onPointerDown={e => h.start(e, p, "size")} />}
    </div>);
});

/** 書式のボタンで選べる色（文字の色・マーカー） */
const INK = ["#2a2740", "#cf3f5b", "#2e7d6d", "#2f6fb5", "#d98a1f", "#7b4bb7"];
const MARK = ["#fff3a3", "#ffd6e0", "#d4f5e3", "#d6e8ff"];
/** ノートの中で最後に選んでいた文字の範囲（11/25）。選択肢（select）や色のボタンを押すと選択が外れるので、押す前の範囲を覚えておく */
let savedRange: Range | null = null;
if (typeof document !== "undefined") document.addEventListener("selectionchange", () => {
  const s = document.getSelection(); if (!s || !s.rangeCount) return;
  const r = s.getRangeAt(0), box = (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest(".rt-edit");
  if (box) savedRange = r.cloneRange();
});
/** 覚えておいた範囲を選び直して、ブラウザの書式のコマンドを実行する。中身が変わると、その欄の onInput が呼ばれて保存の形になる */
function exec(cmd: string, value?: string) {
  const r = savedRange, box = r && (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest(".rt-edit");
  if (!r || !(box instanceof HTMLElement) || !box.isConnected) return false;
  box.focus();
  const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(r);
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand(cmd, false, value);
  return true;
}
/** 選んだ文字の大きさを pt で変える（11/25 夕）。ブラウザのコマンドは 1〜7 の7段階しかないので、
 *  いったん「7」（xxx-large）にしてから、その部分だけ pt に書きかえ、もう一度 onInput を呼ぶ */
function setPt(pt: number) {
  if (!exec("fontSize", "7")) return;
  const box = document.activeElement; if (!(box instanceof HTMLElement) || !box.classList.contains("rt-edit")) return;
  box.querySelectorAll<HTMLElement>('[style*="xxx-large"], font[size="7"]').forEach(el => { el.removeAttribute("size"); el.style.fontSize = `${pt}pt`; });
  box.dispatchEvent(new Event("input", { bubbles: true }));
}
/** 今カーソルのある所の文字の大きさ（pt）。ノートの外なら null */
function currentPt(): number | null {
  const r = savedRange; if (!r) return null;
  const n = r.startContainer, el = n instanceof Element ? n : n.parentElement;
  if (!el || !el.closest(".rt-edit")) return null;
  return clampPt(parseFloat(getComputedStyle(el).fontSize) * 0.75) ?? null;
}

/** 文字の大きさ（pt）の入力欄（11/25 夕）。一覧から選ぶか、数を打って Enter。今カーソルのある所の大きさを出しておく */
function PtBox({ disabled }: { disabled: boolean }) {
  const [v, setV] = useState(""), editing = useRef(false);
  useEffect(() => {
    const on = () => { if (!editing.current) { const pt = currentPt(); setV(pt === null ? "" : String(pt)); } };
    document.addEventListener("selectionchange", on); return () => document.removeEventListener("selectionchange", on);
  }, []);
  const apply = (raw: string) => { const pt = clampPt(raw); editing.current = false; if (pt !== undefined) { setV(String(pt)); setPt(pt); } };
  return (<span className="ptbox" title={`文字の大きさ（${PT_MIN}〜${PT_MAX}pt）`}>
    <input className="fsel pt" list="pt-sizes" inputMode="decimal" disabled={disabled} value={v} placeholder="大きさ" aria-label="文字の大きさ（ポイント）"
      onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }}
      onChange={e => { setV(e.target.value); if ((e.nativeEvent as InputEvent).inputType === "insertReplacementText" || PT_SIZES.some(n => String(n) === e.target.value && !(e.nativeEvent as InputEvent).inputType)) apply(e.target.value); }}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(v); } }} /><span className="mute">pt</span>
    <datalist id="pt-sizes">{PT_SIZES.map(n => <option key={n} value={n} />)}</datalist></span>);
}
/**
 * ノートの中の検索（11/25 夜）。Ctrl＋F か「検索」で開く。Enter で次、Shift＋Enter で前、Esc で閉じる。
 * 見つけた部品を選んで、見える所までスクロールし、文字の所に黄色い印を付ける（印は CSS Custom Highlight。使えないブラウザでは部品の枠だけ）
 */
function FindBar({ parts, root, onPick, onClose, inputRef }: { parts: NotePart[]; root: () => HTMLElement | null; onPick: (partId: string) => void; onClose: () => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState(""), [i, setI] = useState(0);
  const hits = q.trim() ? findInParts(parts, q) : [], n = hits.length, cur = n ? hits[Math.min(i, n - 1)] : null;
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { // 見つけた所に印を付けて、見える所までスクロールする
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights, HL = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    reg?.delete("note-find");
    if (!cur) return;
    onPick(cur.partId);
    const el = root()?.querySelector<HTMLElement>(`[data-id="${cur.partId}"]`); if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    const target = hitTarget(el, cur);
    if (target instanceof HTMLElement && target.classList.contains("rt-edit") && reg && HL) reg.set("note-find", new HL(rangeOfChars(target, cur.start, cur.end)));
    if (target instanceof HTMLInputElement) target.classList.add("found");
    return () => { reg?.delete("note-find"); if (target instanceof HTMLInputElement) target.classList.remove("found"); };
  }, [cur?.partId, cur?.field, cur?.word, cur?.start, q]);
  const step = (d: 1 | -1) => n && setI(x => (Math.min(x, n - 1) + d + n) % n);
  return (<span className="fsearch" role="search">
    <input ref={inputRef} className="fsel" value={q} placeholder="ノートの中を検索" aria-label="ノートの中を検索" onChange={e => setQ(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }} />
    <span className="fcnt" aria-live="polite">{q.trim() ? (n ? `${Math.min(i, n - 1) + 1}/${n}` : "0件") : ""}</span>
    <button className="fb" disabled={!n} onClick={() => step(-1)} title="前（Shift＋Enter）" aria-label="前を探す">↑</button>
    <button className="fb" disabled={!n} onClick={() => step(1)} title="次（Enter）" aria-label="次を探す">↓</button>
    <button className="fb" onClick={onClose} title="検索を閉じる（Esc）" aria-label="検索を閉じる">×</button>
  </span>);
}
/** 見つけた場所の入力欄（文字の欄・単語の用語・意味） */
function hitTarget(el: HTMLElement, h: FindHit): Element | null {
  if (h.field === "text") return el.querySelector(".rt-edit");
  const row = el.querySelectorAll(".wr")[h.word ?? 0]; return row?.querySelectorAll("input")[h.field === "term" ? 0 : 1] ?? null;
}

/**
 * 小さなメニュー（11/25 夜）。ボタンを押すと下に開き、外を押すか、中のボタンを押すと閉じる。
 * 中のボタンを押しても文字の選択が外れないように、mousedown は止める
 */
function Menu({ label, title, disabled, children, cls = "" }: { label: React.ReactNode; title: string; disabled?: boolean; children: (close: () => void) => React.ReactNode; cls?: string }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLSpanElement>(null), pop = useRef<HTMLSpanElement>(null);
  // 開いたメニューが真ん中の欄の右からはみ出すときは、ボタンの右はしにそろえて開く
  useLayoutEffect(() => {
    const el = pop.current; if (!open || !el) return;
    el.style.left = ""; el.style.right = "";
    const edge = (el.closest(".ct, .fs")?.getBoundingClientRect().right ?? window.innerWidth) - 8; // 真ん中の欄（全画面なら画面）の右はし
    if (el.getBoundingClientRect().right > edge) { el.style.left = "auto"; el.style.right = "0"; }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (<span className="fmenu" ref={box}>
    <button className={"fb " + cls + (open ? " on" : "")} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(!open)} title={title} aria-label={title} aria-expanded={open}>{label}<span className="caret">▾</span></button>
    {open && <span className="fpop" ref={pop} role="menu" onMouseDown={e => e.preventDefault()}>{children(() => setOpen(false))}</span>}
  </span>);
}

/**
 * ノートの上の操作のボタン（11/25 夜：4行あったものを1行にまとめた）。よく使うものは並べ、あまり使わないものは ▾・⋯ の中にしまう。
 *   ＋置く▾（枠・文字・図形・矢印）｜文字の種類・大きさ（pt）・太字・斜体・下線｜文字の色▾・マーカー▾｜そろえ方▾｜箇条書き・番号｜⋯（書式を消す・複製・前面へ・背面へ・削除・印刷）
 */
function FormatBar({ sel, count, onAdd, onAlign, onCopy, onLayer, onRemove, onPrint }: {
  sel: NotePart | undefined; count: number; onAdd?: (type: PartType, ft?: FrameType) => void; onAlign: (a: Align) => void;
  onCopy: () => void; onLayer: (to: "front" | "back") => void; onRemove: () => void; onPrint: () => void;
}) {
  const keep = (e: React.MouseEvent) => e.preventDefault(); // ボタンを押しても、文字の選択を外さない
  const canText = !!sel && (sel.partType === PartType.TEXT || (sel.partType === PartType.FRAME && sel.frameType !== "word"));
  const align = sel ? parseRich(sel.style).align ?? "left" : "left";
  const B = ({ cmd, v, label, title, cls = "", after }: { cmd: string; v?: string; label: React.ReactNode; title: string; cls?: string; after?: () => void }) =>
    <button className={"fb " + cls} disabled={!canText} onMouseDown={keep} onClick={() => { exec(cmd, v); after?.(); }} title={title} aria-label={title}>{label}</button>;
  const AL = { left: ["⇤", "左にそろえる"], center: ["≡", "まん中にそろえる"], right: ["⇥", "右にそろえる"] } as const;
  const item = (label: string, onClick: () => void, close: () => void, opt: { disabled?: boolean; cls?: string; title?: string } = {}) =>
    <button className={"fitem " + (opt.cls ?? "")} role="menuitem" disabled={opt.disabled} onMouseDown={keep} onClick={() => { close(); onClick(); }} title={opt.title}>{label}</button>;
  return (<div className="fbar" role="toolbar" aria-label="ノートの操作">
    {onAdd && <Menu label="＋ 置く" title="ノートに部品を置く" cls="put">{close => (<>
      <span className="fhead">枠</span>
      {(Object.keys(FT) as FrameType[]).map(k => <button key={k} className="fitem" role="menuitem" onClick={() => { close(); onAdd(PartType.FRAME, k); }}><i className="fdot" style={{ background: FT[k].c }} />{FT[k].n}</button>)}
      <span className="fhead">そのほか</span>
      {item("文字", () => onAdd(PartType.TEXT), close, { title: "文字を置く（見出しにもできます）" })}
      {item("図形", () => onAdd(PartType.SHAPE), close, { title: "図形（四角・丸）を置く" })}
      {item("矢印", () => onAdd(PartType.ARROW), close, { title: "矢印を置く（両はしの丸をドラッグして向きを変えます）" })}
    </>)}</Menu>}
    <span className="fsep" />
    <select className="fsel" disabled={!canText} value="" onChange={e => { exec("fontName", FONTS[e.target.value as FontKey].css); e.target.value = ""; }} aria-label="文字の種類" title="文字の種類">
      <option value="" disabled>種類</option>{(Object.keys(FONTS) as FontKey[]).map(k => <option key={k} value={k}>{FONTS[k].n}</option>)}</select>
    <PtBox disabled={!canText} />
    <B cmd="bold" label={<b>B</b>} title="太字（Ctrl＋B）" /><B cmd="italic" label={<i>I</i>} title="斜体（Ctrl＋I）" /><B cmd="underline" label={<u>U</u>} title="下線（Ctrl＋U）" />
    <Menu label={<span className="ink">A</span>} title="文字の色" disabled={!canText}>{close => <span className="fpal">{INK.map(c => <B key={c} cmd="foreColor" v={c} cls="sw" label={<span style={{ background: c }} />} title={`文字の色 ${c}`} after={close} />)}</span>}</Menu>
    <Menu label={<span className="hl">A</span>} title="マーカー" disabled={!canText}>{close => (<span className="fpal">{MARK.map(c => <B key={c} cmd="hiliteColor" v={c} cls="sw mk" label={<span style={{ background: c }} />} title={`マーカー ${c}`} after={close} />)}
      <button className="fb sw mk none" onMouseDown={keep} onClick={() => { editSel((_t, r, a, b) => ({ rich: { ...r, runs: clearFmt(r.runs, a, b, ["bg"]) } })); close(); }} title="選んだ文字のマーカーを消す" aria-label="マーカーを消す"><span /></button></span>)}</Menu>
    <Menu label={AL[align][0]} title="そろえ方" disabled={!canText}>{close => <span className="fpal">{(["left", "center", "right"] as Align[]).map(a =>
      <button key={a} className={"fb" + (align === a ? " on" : "")} onMouseDown={keep} onClick={() => { onAlign(a); close(); }} title={AL[a][1]} aria-label={AL[a][1]}>{AL[a][0]}</button>)}</span>}</Menu>
    {(["ul", "ol"] as const).map(k => <button key={k} className="fb" disabled={!canText} onMouseDown={keep}
      onClick={() => editSel((t, r, a, b) => { const x = toggleList(t, r.runs, a, b, k); return { text: x.text, rich: { ...r, runs: x.runs }, sel: x.sel }; })}
      title={k === "ul" ? "箇条書き（・）を付ける・外す" : "番号（1. 2. …）を付ける・外す"} aria-label={k === "ul" ? "箇条書き" : "番号付きリスト"}>{k === "ul" ? "・≡" : "1."}</button>)}
    {count > 1 && <span className="fcount">{count}個を選択中</span>}
    <Menu label="⋯" title="そのほかの操作" cls="more">{close => (<>
      {item("書式を消す", () => editSel((_t, r, a, b) => ({ rich: { ...r, runs: clearFmt(r.runs, a, b) } })), close, { disabled: !canText, title: "選んだ文字の書式（太字・色・マーカー・大きさなど）を全部消す" })}
      <span className="fhead">選んでいる部品{count > 1 ? `（${count}個）` : ""}</span>
      {item("複製", onCopy, close, { disabled: !count, title: "Ctrl＋C → Ctrl＋V でもできます" })}
      {item("前面へ", () => onLayer("front"), close, { disabled: !count })}
      {item("背面へ", () => onLayer("back"), close, { disabled: !count })}
      {item("削除", onRemove, close, { disabled: !count, cls: "del", title: "Delete キーでもできます。Ctrl＋Z で戻せます" })}
      <span className="fhead">ノート</span>
      {item("印刷・PDF", onPrint, close, { title: "ノートだけを印刷します。PDF にするときは、印刷の画面で「PDF に保存」を選んでください" })}
    </>)}</Menu>
  </div>);
}
/**
 * ノートだけを印刷する（11/25 夜）。PDF にしたいときは、印刷の画面で「PDF に保存」を選ぶ。
 * 見えない iframe にノートの写しと CSS を入れて、そこで印刷する（ほかの画面の部分やボタンは写さない）。
 * 横幅は A4 横の紙（約 1040px）に収まるように縮める。マーカーや色も、そのまま印刷する
 */
function printNote(canvas: HTMLElement, width: number, title: string) {
  const css = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const clone = canvas.cloneNode(true) as HTMLElement;
  clone.style.zoom = ""; clone.style.width = `${width}px`;
  clone.querySelectorAll("[contenteditable]").forEach(e => e.removeAttribute("contenteditable"));
  clone.querySelectorAll(".sel").forEach(e => e.classList.remove("sel"));
  const pz = Math.min(1, 1040 / width), esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style><style>
@page{size:A4 landscape;margin:10mm}
html,body{background:#fff;height:auto;overflow:visible;margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1.ptitle{font:700 15px "Zen Maru Gothic",sans-serif;margin:0 0 6px}
#note-canvas{zoom:${pz};margin:0;box-shadow:none}
.ah,.rs,.eh button,.eh input,.eh select{display:none!important}.rt-edit:empty::before{content:none!important}.rt-edit{overflow:visible!important}
</style></head><body><h1 class="ptitle">${esc(title)}</h1>${clone.outerHTML}</body></html>`;
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  f.onload = () => {
    const w = f.contentWindow; if (!w) return;
    // 印刷が終わったら iframe を消して、キーボードの操作（Esc・Ctrl＋Z など）がアプリに戻るようにする（11/25 夜 バグ修正）
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let gone = false;
    const done = () => { if (gone) return; gone = true; f.remove(); if (prev?.isConnected) prev.focus(); else window.focus(); };
    w.addEventListener("afterprint", () => setTimeout(done, 300));
    // 文字（Web フォント）を読み終わってから印刷する。print() は印刷の画面を閉じるまで待つので、そのあとでも片づける
    void (w.document.fonts?.ready ?? Promise.resolve()).then(() => { w.focus(); w.print(); setTimeout(done, 1000); });
  };
  f.srcdoc = html; document.body.appendChild(f);
}
/** Ctrl＋C で覚えた部品（このタブの中だけ。別の学習項目のノートにも貼れる） */
let clip: NotePart[] = [];

/** ノートの大きさは、次に開いたときも同じにする（この端末だけ。保存できないブラウザでは毎回 100%） */
const ZOOM_KEY = "runndesu:noteZoom";
function loadZoom(): number | "fit" { try { const v = localStorage.getItem(ZOOM_KEY); if (v === "fit") return v; const n = Number(v); return n >= 0.5 && n <= 1.5 ? n : 1; } catch { return 1; } }
function saveZoom(v: number | "fit") { try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* 保存できなくても大きさは変えられる */ } }

export function NoteCanvas({ parts, onChange, onAdd, title = "ノート" }: { parts: NotePart[]; onChange: (parts: NotePart[]) => void; onAdd?: (type: PartType, ft?: FrameType) => NotePart | void; title?: string }) {
  const ref = useRef({ parts, onChange }); ref.current = { parts, onChange };
  const drag = useRef<{ id: string; mode: Mode; sx: number; sy: number; x: number; y: number; w: number; h: number; cx: number; cy: number; raf: number; z: number; w0: number; text: string; group?: Map<string, { x: number; y: number }> } | null>(null);
  // 11/23：全画面で右のほうに置いた部品が、ふつうの画面で切れて見えなくなっていた。
  // ノートの幅を「いちばん右の部品」まで広げて横にスクロールできるようにし、「縮小して全体を見る」も選べるようにした
  // 11/25：「−」「＋」でノートの大きさを変えられるようにした。"fit" は「欄の幅に全体を合わせる」。選んだ大きさは次に開いたときも同じ
  const wrap = useRef<HTMLDivElement>(null), [cw, setCw] = useState(0), [zm, setZm] = useState<number | "fit">(loadZoom), [, setTick] = useState(0);
  // 11/25：選んでいる部品（書式・複製・重なり順の相手）。部品を押すか、中の文字を押すと選ばれる
  // 11/25 夜：Shift（か Ctrl）を押しながら押すと、いくつも選べる。書式のボタンは最後に選んだ部品（selPart）に効く。
  //           動かす・複製・削除・重なり順は、選んでいる部品ぜんぶに効く
  const [selIds, setSelIds] = useState<string[]>([]), selRef = useRef(selIds); selRef.current = selIds;
  const selId = selIds[selIds.length - 1] ?? null, setSelId = (id: string | null) => setSelIds(id ? [id] : []);
  const selPart = parts.find(x => x.partId === selId), selParts = parts.filter(x => selIds.includes(x.partId));
  const [finding, setFinding] = useState(false), findInput = useRef<HTMLInputElement>(null);
  /** 全画面を開いているときは、全画面のノートだけがキーボードの操作を受ける（うしろのノートが同じ操作を二重にしないように） */
  const isTop = () => { const fs = document.querySelector(".fs"); return !fs || !!wrap.current?.closest(".fs"); };
  const changeZoom = (v: number | "fit") => { setZm(v); saveZoom(v); };
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth)); ro.observe(el); setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // ドラッグ中は幅を縮めない（縮小表示の倍率がドラッグの途中で変わると、部品がマウスからずれるため）
  const W = Math.max(canvasWidth(parts), drag.current?.w0 ?? 0), over = cw > 0 && W > cw;
  const z = zm === "fit" ? (over ? cw / W : 1) : zm;
  const zoom = useRef(z); zoom.current = z;
  const width = useRef(W); width.current = W;

  // 部品に渡す関数は最初に1回だけ作る（いつも最新の els / onChange を ref から読む）
  const h = useRef<Handlers | null>(null);
  const apply = useCallback(() => {
    const d = drag.current; if (!d) return; d.raf = 0;
    const dx = (d.cx - d.sx) / d.z, dy = (d.cy - d.sy) / d.z, r = ref.current; // 縮小して表示しているときは、マウスの動きを元の大きさに直す
    r.onChange(r.parts.map(x => {
      if (x.partId !== d.id) return x;
      if (d.mode === "p1" || d.mode === "p2") { // 矢印の点：動かしていないほうの点はそのままで、部品の位置と大きさを作り直す
        const a = arrowPoints({ width: d.w, height: d.h, text: d.text }), ax = d.x + a.x1, ay = d.y + a.y1, bx = d.x + a.x2, by = d.y + a.y2;
        const n = d.mode === "p1" ? arrowFromPoints(ax + dx, ay + dy, bx, by) : arrowFromPoints(ax, ay, bx + dx, by + dy);
        return new NotePart({ ...x, ...n, text: withArrowStyle(n.text, arrowStyleOf(d.text)), updatedAt: now() }); // 太さ・点線はそのまま
      }
      return new NotePart(d.mode === "move" ? { ...x, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy), updatedAt: now() } : { ...x, width: Math.max(60, d.w + dx), height: Math.max(30, d.h + dy), updatedAt: now() });
    }).map(x => { // いくつも選んで動かすときは、ほかの選んだ部品も同じだけ動かす
      const g = d.group?.get(x.partId); if (!g || x.partId === d.id) return x;
      return new NotePart({ ...x, x: Math.max(0, g.x + dx), y: Math.max(0, g.y + dy), updatedAt: now() });
    }));
  }, []);
  const mv = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return; d.cx = e.clientX; d.cy = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(apply);
  }, [apply]);
  const up = useCallback(() => {
    const d = drag.current; if (d?.raf) { cancelAnimationFrame(d.raf); apply(); } // 最後の位置は必ず反映
    if (d?.mode === "size") { const r = ref.current, n = grow(r.parts, d.id, d.h); if (n !== r.parts) r.onChange(n); } // 大きくしたら下をずらす
    drag.current = null; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
    setTick(t => t + 1); // ドラッグが終わったら、幅と倍率を部品に合わせて直す
  }, [apply, mv]);
  if (!h.current) h.current = {
    upd: (id, patch) => {
      const r = ref.current, old = r.parts.find(x => x.partId === id)?.height ?? 0;
      const n = r.parts.map(x => x.partId === id ? new NotePart({ ...x, ...patch, updatedAt: now() }) : x);
      r.onChange(patch.height !== undefined ? grow(n, id, old) : n); // 高くなったら下の部品をずらす（単語の追加・文字があふれたとき）
    },
    remove: id => { const r = ref.current; r.onChange(r.parts.filter(x => x.partId !== id)); },
    select: (id, add) => setSelIds(s => add ? (s.includes(id) ? s.filter(x => x !== id) : [...s, id]) : s.includes(id) ? [...s.filter(x => x !== id), id] : [id]),
    start: (e, part, mode) => {
      e.preventDefault(); e.stopPropagation();
      drag.current = { id: part.partId, mode, sx: e.clientX, sy: e.clientY, x: part.x, y: part.y, w: part.width, h: part.height, cx: e.clientX, cy: e.clientY, raf: 0, z: zoom.current, w0: width.current, text: part.text,
        group: mode === "move" && selRef.current.length > 1 && selRef.current.includes(part.partId) ? new Map(ref.current.parts.filter(x => selRef.current.includes(x.partId)).map(x => [x.partId, { x: x.x, y: x.y }])) : undefined };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    },
  };
  useEffect(() => () => up(), [up]); // ドラッグ中に画面を離れても、イベントを残さない

  // 11/25：複製・貼り付け・重なり順
  const paste = (src: readonly NotePart[]) => { if (!src.length) return; const r = ref.current, c = src.map(x => copyPart(x)); r.onChange([...r.parts, ...c]); setSelIds(c.map(x => x.partId)); };
  const layer = (to: "front" | "back") => { const ids = selRef.current; if (ids.length) { const r = ref.current; r.onChange(moveLayers(r.parts, ids, to)); } };
  const removeSel = () => { const ids = selRef.current; if (ids.length) { const r = ref.current; r.onChange(r.parts.filter(x => !ids.includes(x.partId))); setSelIds([]); } };
  const setAlign = (a: Align) => { const p = selPart; if (p) h.current!.upd(p.partId, { style: stringifyRich({ ...parseRich(p.style), align: a }, p.text.length) }); };
  // Ctrl＋C・Ctrl＋V：文字を書いているとき（入力欄の中）は、ふつうの文字のコピー・貼り付けにする。部品を選んでいるときだけ部品をコピーする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".ov") || !isTop()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setFinding(true); setTimeout(() => findInput.current?.select(), 0); return; } // ノートの中を検索
      const a = document.activeElement as HTMLElement | null;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      if (!e.ctrlKey && !e.metaKey) { // 11/25 夜：Delete で選んだ部品を消す（Ctrl＋Z で戻せる）。Esc で選ぶのをやめる
        if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.length) { e.preventDefault(); removeSel(); }
        else if (e.key === "Escape" && selRef.current.length) setSelIds([]);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "c") { const ps = ref.current.parts.filter(x => selRef.current.includes(x.partId)); if (ps.length) { clip = ps; e.preventDefault(); } }
      else if (k === "v" && clip.length) { e.preventDefault(); paste(clip); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  let H = 520; for (const p of parts) H = Math.max(H, p.y + p.height + 160);
  return (<div className="cwrap">
    <div className="cover zbar">
      <FormatBar sel={selPart} count={selParts.length} onAdd={onAdd && ((t, f) => { const n = onAdd(t, f); if (n) setSelId(n.partId); })} onAlign={setAlign}
        onCopy={() => paste(selParts)} onLayer={layer} onRemove={removeSel} onPrint={() => { const c = wrap.current?.querySelector<HTMLElement>(".canvas"); if (c) printNote(c, Math.max(W, 400), title); }} />
      {over && z * W > cw + 1 && <span className="mute">右にはみ出した部品があります。横にスクロールするか「全体」で見られます。</span>}<span className="sp" />
      {finding ? <FindBar parts={parts} root={() => wrap.current} inputRef={findInput} onPick={id => setSelIds([id])} onClose={() => setFinding(false)} />
        : <button className="btn sm line" onClick={() => { setFinding(true); setTimeout(() => findInput.current?.focus(), 0); }} title="ノートの中を検索（Ctrl＋F）">検索</button>}
      <button className="btn sm line" onClick={() => changeZoom(stepZoom(z, -1))} disabled={z <= 0.5} aria-label="ノートを小さく" title="小さく">−</button>
      <button className="link zval" onClick={() => changeZoom(1)} title="100% に戻す">{Math.round(z * 100)}%</button>
      <button className="btn sm line" onClick={() => changeZoom(stepZoom(z, 1))} disabled={z >= 1.5} aria-label="ノートを大きく" title="大きく">＋</button>
      <button className={"btn sm line" + (zm === "fit" ? " on" : "")} onClick={() => changeZoom(zm === "fit" ? 1 : "fit")} title="欄の幅に全体を合わせる">全体</button>
    </div>
    <div className="cscroll" ref={wrap}>
      <div className="canvas" id="note-canvas" style={{ height: H, width: cw ? Math.max(W, cw / z) : undefined, zoom: z === 1 ? undefined : z }}
        onPointerDown={e => { if (e.target === e.currentTarget) setSelIds([]); }}>{/* 何もない所を押すと、選ぶのをやめる */}
        {parts.map(p => <PartView key={p.partId} part={p} h={h.current!} sel={selIds.includes(p.partId)} />)}
      </div></div></div>);
}
