// ノートのキャンバス：枠・文字・図形・矢印を置いて、動かす・大きさを変える・色を変える
// 1つの部品を動かしても、ほかの部品は描き直さない（ElView を memo）。ドラッグは1フレームに1回だけ反映する。
// 11/12：部品が大きくなったら（大きさの変更・単語の追加・文字があふれたとき）、NoteManager.adjustOverlap で下の部品をずらす（A）
import { memo, useCallback, useEffect, useRef } from "react";
import type { El } from "../types";
import { FT } from "../lib/logic";
import { controller } from "../controller/Controller";

/** id の部品が old より高くなっていたら、下の部品をずらす（保存はしない。ノートの下書きを変えるだけ） */
const grow = (els: El[], id: string, old: number): El[] => {
  const e = els.find(x => x.id === id);
  return e && e.h > old ? controller.noteManager.adjustElements(els, id) : els;
};

type Mode = "move" | "size";
interface Handlers {
  upd: (id: string, p: Partial<El>) => void;
  remove: (id: string) => void;
  start: (e: React.PointerEvent, el: El, mode: Mode) => void;
}

const ElView = memo(function ElView({ el, h }: { el: El; h: Handlers }) {
  const label = el.kind === "frame" ? FT[el.ft!].n : el.kind === "text" ? "文字" : el.kind === "shape" ? "図形" : "矢印";
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const words = el.words ?? [];
  return (
    <div data-id={el.id} className={`el ${el.kind}`} style={{ left: el.x, top: el.y, width: el.w, height: el.h, borderColor: el.color, background: el.kind === "frame" ? el.color + "14" : undefined, borderRadius: el.kind === "shape" && el.shape === "ellipse" ? "50%" : undefined }}>
      <div className="eh" style={{ color: el.color }} onPointerDown={e => h.start(e, el, "move")}>
        <span>{label}</span>
        {el.kind === "text" && <select value={el.head ?? 0} onPointerDown={stop} onChange={e => h.upd(el.id, { head: Number(e.target.value) as El["head"] })}><option value={0}>本文</option><option value={1}>見出し1</option><option value={2}>見出し2</option><option value={3}>見出し3</option></select>}
        {el.kind === "shape" && <select value={el.shape} onPointerDown={stop} onChange={e => h.upd(el.id, { shape: e.target.value as El["shape"] })}><option value="rect">四角</option><option value="ellipse">丸</option></select>}
        <input type="color" value={el.color} onPointerDown={stop} onChange={e => h.upd(el.id, { color: e.target.value })} aria-label="色" />
        <button onPointerDown={stop} onClick={() => h.remove(el.id)} aria-label="削除">×</button>
      </div>
      {el.kind === "frame" && el.ft === "word" && (
        <div className="wl">{words.map((w, i) => (
          <div className="wr" key={i}><input placeholder="用語" value={w.term} onChange={e => h.upd(el.id, { words: words.map((x, j) => j === i ? { ...x, term: e.target.value } : x) })} />
            <input placeholder="意味" value={w.meaning} onChange={e => h.upd(el.id, { words: words.map((x, j) => j === i ? { ...x, meaning: e.target.value } : x) })} />
            <button onClick={() => h.upd(el.id, { words: words.filter((_, j) => j !== i) })} aria-label="この単語を消す">×</button></div>))}
          <button className="btn sm" onClick={() => h.upd(el.id, { words: [...words, { term: "", meaning: "" }], h: el.h + 28 })}>＋ 単語</button></div>)}
      {(el.kind === "text" || (el.kind === "frame" && el.ft !== "word")) && <textarea className={`h${el.head ?? 0}`} value={el.text} placeholder={el.kind === "text" ? "文字を入力" : "ここに書く"} onChange={e => {
        // 文字があふれたら、あふれた分だけ部品を高くする（下の部品は grow でずらす）
        const t = e.target, over = t.scrollHeight - t.clientHeight;
        h.upd(el.id, over > 0 ? { text: t.value, h: el.h + over } : { text: t.value });
      }} />}
      {el.kind === "arrow" && <svg width="100%" height={el.h - 24} viewBox={`0 0 ${el.w} ${el.h - 24}`} preserveAspectRatio="none"><line x1="4" y1="50%" x2={el.w - 14} y2="50%" stroke={el.color} strokeWidth="3" /><polygon points={`${el.w - 14},${(el.h - 24) / 2 - 7} ${el.w - 2},${(el.h - 24) / 2} ${el.w - 14},${(el.h - 24) / 2 + 7}`} fill={el.color} /></svg>}
      <span className="rs" onPointerDown={e => h.start(e, el, "size")} />
    </div>);
});

export function NoteCanvas({ els, onChange }: { els: El[]; onChange: (e: El[]) => void }) {
  const ref = useRef({ els, onChange }); ref.current = { els, onChange };
  const drag = useRef<{ id: string; mode: Mode; sx: number; sy: number; x: number; y: number; w: number; h: number; cx: number; cy: number; raf: number } | null>(null);

  // 部品に渡す関数は最初に1回だけ作る（いつも最新の els / onChange を ref から読む）
  const h = useRef<Handlers | null>(null);
  const apply = useCallback(() => {
    const d = drag.current; if (!d) return; d.raf = 0;
    const dx = d.cx - d.sx, dy = d.cy - d.sy, r = ref.current;
    r.onChange(r.els.map(x => x.id !== d.id ? x : d.mode === "move" ? { ...x, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy), at: Date.now() } : { ...x, w: Math.max(60, d.w + dx), h: Math.max(30, d.h + dy), at: Date.now() }));
  }, []);
  const mv = useCallback((e: PointerEvent) => {
    const d = drag.current; if (!d) return; d.cx = e.clientX; d.cy = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(apply);
  }, [apply]);
  const up = useCallback(() => {
    const d = drag.current; if (d?.raf) { cancelAnimationFrame(d.raf); apply(); } // 最後の位置は必ず反映
    if (d?.mode === "size") { const r = ref.current, n = grow(r.els, d.id, d.h); if (n !== r.els) r.onChange(n); } // 大きくしたら下をずらす
    drag.current = null; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
  }, [apply, mv]);
  if (!h.current) h.current = {
    upd: (id, p) => {
      const r = ref.current, old = r.els.find(e => e.id === id)?.h ?? 0;
      const n = r.els.map(e => e.id === id ? { ...e, ...p, at: Date.now() } : e);
      r.onChange(p.h !== undefined ? grow(n, id, old) : n); // 高くなったら下の部品をずらす（単語の追加・文字があふれたとき）
    },
    remove: id => { const r = ref.current; r.onChange(r.els.filter(x => x.id !== id)); },
    start: (e, el, mode) => {
      e.preventDefault(); e.stopPropagation();
      drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h, cx: e.clientX, cy: e.clientY, raf: 0 };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    },
  };
  useEffect(() => () => up(), [up]); // ドラッグ中に画面を離れても、イベントを残さない

  let H = 520; for (const e of els) H = Math.max(H, e.y + e.h + 160);
  return (
    <div className="canvas" id="note-canvas" style={{ height: H }}>
      {els.map(el => <ElView key={el.id} el={el} h={h.current!} />)}
    </div>);
}
