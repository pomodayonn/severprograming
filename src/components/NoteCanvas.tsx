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
import { canvasWidth, copyPart, FT, moveLayer, newWord, stepZoom } from "../lib/logic";
import { FONTS, SIZES, fromNodes, parseRich, stringifyRich, toHtml, type Align, type FontKey, type SizeKey } from "../lib/rich";
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

type Mode = "move" | "size";
interface Handlers {
  upd: (partId: string, patch: Partial<NotePart>) => void;
  remove: (partId: string) => void;
  start: (e: React.PointerEvent, part: NotePart, mode: Mode) => void;
  /** 部品を選ぶ（11/25。書式のボタン・複製・重なり順は、選んでいる部品に効く） */
  select: (partId: string) => void;
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
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (last.current && last.current.text === p.text && last.current.style === p.style) return;
    el.innerHTML = toHtml(p.text, parseRich(p.style, p.text.length));
    last.current = { text: p.text, style: p.style };
  }, [p.text, p.style]);
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
    onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); document.execCommand("insertLineBreak"); } }}
    onPaste={e => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")); }} />;
});

/** 部品の枠（文字の外）を押したら、書いていた欄から出る（ドラッグはフォーカスを動かさないので、Ctrl＋C が文字のコピーのままになってしまう） */
function blurEditor(target: EventTarget) {
  const a = document.activeElement;
  if (a instanceof HTMLElement && a.isContentEditable && !(target instanceof Element && target.closest(".rt-edit"))) a.blur();
}

const PartView = memo(function PartView({ part: p, h, sel }: { part: NotePart; h: Handlers; sel: boolean }) {
  const frame = p.partType === PartType.FRAME, text = p.partType === PartType.TEXT, shape = p.partType === PartType.SHAPE;
  const label = frame ? (FT[p.frameType as FrameType]?.n ?? LABEL[p.partType]) : LABEL[p.partType];
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const words = p.words, wordFrame = frame && p.frameType === "word";
  const setWord = (i: number, patch: Partial<Word>) => h.upd(p.partId, { words: words.map((w, j) => j === i ? new Word({ ...w, ...patch, updatedAt: now() }) : w) });
  return (
    <div data-id={p.partId} className={`el ${CLS[p.partType]}${sel ? " sel" : ""}`} onPointerDownCapture={e => { h.select(p.partId); blurEditor(e.target); }} style={{ left: p.x, top: p.y, width: p.width, height: p.height, borderColor: p.color, background: frame ? p.color + "14" : undefined, borderRadius: shape && NotePart.shapeOf(p) === "ellipse" ? "50%" : undefined }}>
      <div className="eh" style={{ color: p.color }} onPointerDown={e => h.start(e, p, "move")}>
        <span>{label}</span>
        {text && <select value={p.headingLevel} onPointerDown={stop} onChange={e => h.upd(p.partId, { headingLevel: Number(e.target.value) })}><option value={0}>本文</option><option value={1}>見出し1</option><option value={2}>見出し2</option><option value={3}>見出し3</option></select>}
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
      {p.partType === PartType.ARROW && <svg width="100%" height={p.height - 24} viewBox={`0 0 ${p.width} ${p.height - 24}`} preserveAspectRatio="none"><line x1="4" y1="50%" x2={p.width - 14} y2="50%" stroke={p.color} strokeWidth="3" /><polygon points={`${p.width - 14},${(p.height - 24) / 2 - 7} ${p.width - 2},${(p.height - 24) / 2} ${p.width - 14},${(p.height - 24) / 2 + 7}`} fill={p.color} /></svg>}
      <span className="rs" onPointerDown={e => h.start(e, p, "size")} />
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
const FONT_SIZE: Record<SizeKey, string> = { s: "2", m: "3", l: "5", xl: "6" }; // execCommand の fontSize の番号（styleWithCSS で small・medium・x-large・xx-large になる）

/** ノートの上の書式のボタン（11/25）。文字の種類・大きさ・太字・斜体・下線・文字の色・マーカー・そろえ方・書式を消す・複製・重なり順 */
function FormatBar({ sel, onAlign, onCopy, onLayer }: { sel: NotePart | undefined; onAlign: (a: Align) => void; onCopy: () => void; onLayer: (to: "front" | "back") => void }) {
  const keep = (e: React.MouseEvent) => e.preventDefault(); // ボタンを押しても、文字の選択を外さない
  const canText = !!sel && (sel.partType === PartType.TEXT || (sel.partType === PartType.FRAME && sel.frameType !== "word"));
  const align = sel ? parseRich(sel.style).align ?? "left" : "left";
  const B = ({ cmd, v, label, title, cls = "" }: { cmd: string; v?: string; label: React.ReactNode; title: string; cls?: string }) =>
    <button className={"fb " + cls} disabled={!canText} onMouseDown={keep} onClick={() => exec(cmd, v)} title={title} aria-label={title}>{label}</button>;
  return (<div className="fbar" role="toolbar" aria-label="文字の書式">
    <select className="fsel" disabled={!canText} value="" onChange={e => { exec("fontName", FONTS[e.target.value as FontKey].css); e.target.value = ""; }} aria-label="文字の種類" title="文字の種類">
      <option value="" disabled>文字の種類</option>{(Object.keys(FONTS) as FontKey[]).map(k => <option key={k} value={k}>{FONTS[k].n}</option>)}</select>
    <select className="fsel" disabled={!canText} value="" onChange={e => { exec("fontSize", FONT_SIZE[e.target.value as SizeKey]); e.target.value = ""; }} aria-label="文字の大きさ" title="文字の大きさ">
      <option value="" disabled>大きさ</option>{(Object.keys(SIZES) as SizeKey[]).map(k => <option key={k} value={k}>{SIZES[k].n}</option>)}</select>
    <B cmd="bold" label={<b>B</b>} title="太字（Ctrl＋B）" /><B cmd="italic" label={<i>I</i>} title="斜体（Ctrl＋I）" /><B cmd="underline" label={<u>U</u>} title="下線（Ctrl＋U）" />
    <span className="fgrp" aria-label="文字の色">{INK.map(c => <B key={c} cmd="foreColor" v={c} cls="sw" label={<span style={{ background: c }} />} title={`文字の色 ${c}`} />)}</span>
    <span className="fgrp" aria-label="マーカー">{MARK.map(c => <B key={c} cmd="hiliteColor" v={c} cls="sw mk" label={<span style={{ background: c }} />} title={`マーカー ${c}`} />)}</span>
    <span className="fgrp" aria-label="そろえ方">{(["left", "center", "right"] as Align[]).map(a => <button key={a} className={"fb" + (canText && align === a ? " on" : "")} disabled={!canText} onMouseDown={keep} onClick={() => onAlign(a)} title={{ left: "左にそろえる", center: "まん中にそろえる", right: "右にそろえる" }[a]} aria-label={{ left: "左にそろえる", center: "まん中にそろえる", right: "右にそろえる" }[a]}>{{ left: "⇤", center: "≡", right: "⇥" }[a]}</button>)}</span>
    <B cmd="removeFormat" label="書式を消す" title="選んだ文字の書式を消す" cls="txt" />
    <span className="fgrp" aria-label="部品"><button className="fb txt" disabled={!sel} onMouseDown={keep} onClick={onCopy} title="選んでいる部品を複製（Ctrl＋C → Ctrl＋V でもできます）">複製</button>
      <button className="fb txt" disabled={!sel} onMouseDown={keep} onClick={() => onLayer("front")} title="選んでいる部品をいちばん前に">前面へ</button>
      <button className="fb txt" disabled={!sel} onMouseDown={keep} onClick={() => onLayer("back")} title="選んでいる部品をいちばん後ろに">背面へ</button></span>
  </div>);
}
/** Ctrl＋C で覚えた部品（このタブの中だけ。別の学習項目のノートにも貼れる） */
let clip: NotePart | null = null;

/** ノートの大きさは、次に開いたときも同じにする（この端末だけ。保存できないブラウザでは毎回 100%） */
const ZOOM_KEY = "runndesu:noteZoom";
function loadZoom(): number | "fit" { try { const v = localStorage.getItem(ZOOM_KEY); if (v === "fit") return v; const n = Number(v); return n >= 0.5 && n <= 1.5 ? n : 1; } catch { return 1; } }
function saveZoom(v: number | "fit") { try { localStorage.setItem(ZOOM_KEY, String(v)); } catch { /* 保存できなくても大きさは変えられる */ } }

export function NoteCanvas({ parts, onChange }: { parts: NotePart[]; onChange: (parts: NotePart[]) => void }) {
  const ref = useRef({ parts, onChange }); ref.current = { parts, onChange };
  const drag = useRef<{ id: string; mode: Mode; sx: number; sy: number; x: number; y: number; w: number; h: number; cx: number; cy: number; raf: number; z: number; w0: number } | null>(null);
  // 11/23：全画面で右のほうに置いた部品が、ふつうの画面で切れて見えなくなっていた。
  // ノートの幅を「いちばん右の部品」まで広げて横にスクロールできるようにし、「縮小して全体を見る」も選べるようにした
  // 11/25：「−」「＋」でノートの大きさを変えられるようにした。"fit" は「欄の幅に全体を合わせる」。選んだ大きさは次に開いたときも同じ
  const wrap = useRef<HTMLDivElement>(null), [cw, setCw] = useState(0), [zm, setZm] = useState<number | "fit">(loadZoom), [, setTick] = useState(0);
  // 11/25：選んでいる部品（書式・複製・重なり順の相手）。部品を押すか、中の文字を押すと選ばれる
  const [selId, setSelId] = useState<string | null>(null), selRef = useRef(selId); selRef.current = selId;
  const selPart = parts.find(x => x.partId === selId);
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
    r.onChange(r.parts.map(x => x.partId !== d.id ? x : new NotePart(d.mode === "move" ? { ...x, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy), updatedAt: now() } : { ...x, width: Math.max(60, d.w + dx), height: Math.max(30, d.h + dy), updatedAt: now() })));
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
    select: id => setSelId(id),
    start: (e, part, mode) => {
      e.preventDefault(); e.stopPropagation();
      drag.current = { id: part.partId, mode, sx: e.clientX, sy: e.clientY, x: part.x, y: part.y, w: part.width, h: part.height, cx: e.clientX, cy: e.clientY, raf: 0, z: zoom.current, w0: width.current };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    },
  };
  useEffect(() => () => up(), [up]); // ドラッグ中に画面を離れても、イベントを残さない

  // 11/25：複製・貼り付け・重なり順
  const paste = (src: NotePart) => { const r = ref.current, c = copyPart(src); r.onChange([...r.parts, c]); setSelId(c.partId); };
  const layer = (to: "front" | "back") => { const id = selRef.current; if (id) { const r = ref.current; r.onChange(moveLayer(r.parts, id, to)); } };
  const setAlign = (a: Align) => { const p = selPart; if (p) h.current!.upd(p.partId, { style: stringifyRich({ ...parseRich(p.style), align: a }, p.text.length) }); };
  // Ctrl＋C・Ctrl＋V：文字を書いているとき（入力欄の中）は、ふつうの文字のコピー・貼り付けにする。部品を選んでいるときだけ部品をコピーする
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector(".ov")) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "c") { const p = ref.current.parts.find(x => x.partId === selRef.current); if (p) { clip = p; e.preventDefault(); } }
      else if (k === "v" && clip) { e.preventDefault(); paste(clip); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  let H = 520; for (const p of parts) H = Math.max(H, p.y + p.height + 160);
  return (<div className="cwrap">
    <div className="cover zbar">
      <FormatBar sel={selPart} onAlign={setAlign} onCopy={() => selPart && paste(selPart)} onLayer={layer} />
      {over && z * W > cw + 1 && <span className="mute">右にはみ出した部品があります。横にスクロールするか「全体」で見られます。</span>}<span className="sp" />
      <button className="btn sm line" onClick={() => changeZoom(stepZoom(z, -1))} disabled={z <= 0.5} aria-label="ノートを小さく" title="小さく">−</button>
      <button className="link zval" onClick={() => changeZoom(1)} title="100% に戻す">{Math.round(z * 100)}%</button>
      <button className="btn sm line" onClick={() => changeZoom(stepZoom(z, 1))} disabled={z >= 1.5} aria-label="ノートを大きく" title="大きく">＋</button>
      <button className={"btn sm line" + (zm === "fit" ? " on" : "")} onClick={() => changeZoom(zm === "fit" ? 1 : "fit")} title="欄の幅に全体を合わせる">全体</button>
    </div>
    <div className="cscroll" ref={wrap}>
      <div className="canvas" id="note-canvas" style={{ height: H, width: cw ? Math.max(W, cw / z) : undefined, zoom: z === 1 ? undefined : z }}>
        {parts.map(p => <PartView key={p.partId} part={p} h={h.current!} sel={p.partId === selId} />)}
      </div></div></div>);
}
