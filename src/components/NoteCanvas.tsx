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
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { FrameType } from "../types";
import { NotePart, type ShapeKind } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { now } from "../beans/DateTime";
import { PartType } from "../enums/PartType";
import { canvasWidth, FT, newWord } from "../lib/logic";
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
}

const PartView = memo(function PartView({ part: p, h }: { part: NotePart; h: Handlers }) {
  const frame = p.partType === PartType.FRAME, text = p.partType === PartType.TEXT, shape = p.partType === PartType.SHAPE;
  const label = frame ? (FT[p.frameType as FrameType]?.n ?? LABEL[p.partType]) : LABEL[p.partType];
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const words = p.words, wordFrame = frame && p.frameType === "word";
  const setWord = (i: number, patch: Partial<Word>) => h.upd(p.partId, { words: words.map((w, j) => j === i ? new Word({ ...w, ...patch, updatedAt: now() }) : w) });
  return (
    <div data-id={p.partId} className={`el ${CLS[p.partType]}`} style={{ left: p.x, top: p.y, width: p.width, height: p.height, borderColor: p.color, background: frame ? p.color + "14" : undefined, borderRadius: shape && NotePart.shapeOf(p) === "ellipse" ? "50%" : undefined }}>
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
      {(text || (frame && !wordFrame)) && <textarea className={`h${p.headingLevel}`} value={p.text} placeholder={text ? "文字を入力" : "ここに書く"} onChange={e => {
        // 文字があふれたら、あふれた分だけ部品を高くする（下の部品は grow でずらす）
        const t = e.target, over = t.scrollHeight - t.clientHeight;
        h.upd(p.partId, over > 0 ? { text: t.value, height: p.height + over } : { text: t.value });
      }} />}
      {p.partType === PartType.ARROW && <svg width="100%" height={p.height - 24} viewBox={`0 0 ${p.width} ${p.height - 24}`} preserveAspectRatio="none"><line x1="4" y1="50%" x2={p.width - 14} y2="50%" stroke={p.color} strokeWidth="3" /><polygon points={`${p.width - 14},${(p.height - 24) / 2 - 7} ${p.width - 2},${(p.height - 24) / 2} ${p.width - 14},${(p.height - 24) / 2 + 7}`} fill={p.color} /></svg>}
      <span className="rs" onPointerDown={e => h.start(e, p, "size")} />
    </div>);
});

export function NoteCanvas({ parts, onChange }: { parts: NotePart[]; onChange: (parts: NotePart[]) => void }) {
  const ref = useRef({ parts, onChange }); ref.current = { parts, onChange };
  const drag = useRef<{ id: string; mode: Mode; sx: number; sy: number; x: number; y: number; w: number; h: number; cx: number; cy: number; raf: number; z: number; w0: number } | null>(null);
  // 11/23：全画面で右のほうに置いた部品が、ふつうの画面で切れて見えなくなっていた。
  // ノートの幅を「いちばん右の部品」まで広げて横にスクロールできるようにし、「縮小して全体を見る」も選べるようにした
  const wrap = useRef<HTMLDivElement>(null), [cw, setCw] = useState(0), [fit, setFit] = useState(false), [, setTick] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth)); ro.observe(el); setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // ドラッグ中は幅を縮めない（縮小表示の倍率がドラッグの途中で変わると、部品がマウスからずれるため）
  const W = Math.max(canvasWidth(parts), drag.current?.w0 ?? 0), over = cw > 0 && W > cw, z = fit && over ? cw / W : 1;
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
    start: (e, part, mode) => {
      e.preventDefault(); e.stopPropagation();
      drag.current = { id: part.partId, mode, sx: e.clientX, sy: e.clientY, x: part.x, y: part.y, w: part.width, h: part.height, cx: e.clientX, cy: e.clientY, raf: 0, z: zoom.current, w0: width.current };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    },
  };
  useEffect(() => () => up(), [up]); // ドラッグ中に画面を離れても、イベントを残さない

  let H = 520; for (const p of parts) H = Math.max(H, p.y + p.height + 160);
  return (<div className="cwrap">
    {over && <div className="cover"><span>{fit ? "ノート全体を縮小して表示しています。" : "右にはみ出した部品があります。横にスクロールすると見えます。"}</span>
      <button className="btn sm line" onClick={() => setFit(!fit)}>{fit ? "元の大きさに戻す" : "縮小して全体を見る"}</button></div>}
    <div className="cscroll" ref={wrap}>
      <div className="canvas" id="note-canvas" style={{ height: H, width: over ? W : undefined, zoom: z === 1 ? undefined : z }}>
        {parts.map(p => <PartView key={p.partId} part={p} h={h.current!} />)}
      </div></div></div>);
}
