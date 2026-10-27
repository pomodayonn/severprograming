// ノートのキャンバス：枠・文字・図形・矢印を置いて、動かす・大きさを変える・色を変える
import { useRef } from "react";
import type { El } from "../types";
import { FT } from "../lib/logic";

export function NoteCanvas({ els, onChange }: { els: El[]; onChange: (e: El[]) => void }) {
  const ref = useRef({ els, onChange }); ref.current = { els, onChange };
  const drag = useRef<{ id: string; mode: "move" | "size"; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const upd = (id: string, p: Partial<El>) => onChange(els.map(e => e.id === id ? { ...e, ...p, at: Date.now() } : e));
  const mv = (e: PointerEvent) => {
    const d = drag.current; if (!d) return; const dx = e.clientX - d.sx, dy = e.clientY - d.sy, r = ref.current;
    r.onChange(r.els.map(x => x.id !== d.id ? x : d.mode === "move" ? { ...x, x: Math.max(0, d.x + dx), y: Math.max(0, d.y + dy), at: Date.now() } : { ...x, w: Math.max(60, d.w + dx), h: Math.max(30, d.h + dy), at: Date.now() }));
  };
  const up = () => { drag.current = null; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  const start = (e: React.PointerEvent, el: El, mode: "move" | "size") => {
    e.preventDefault(); e.stopPropagation(); drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, x: el.x, y: el.y, w: el.w, h: el.h };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const H = Math.max(520, ...els.map(e => e.y + e.h + 160));
  return (
    <div className="canvas" id="note-canvas" style={{ height: H }}>
      {els.map(el => {
        const label = el.kind === "frame" ? FT[el.ft!].n : el.kind === "text" ? "文字" : el.kind === "shape" ? "図形" : "矢印";
        return (
          <div key={el.id} data-id={el.id} className={`el ${el.kind}`} style={{ left: el.x, top: el.y, width: el.w, height: el.h, borderColor: el.color, background: el.kind === "frame" ? el.color + "14" : undefined, borderRadius: el.kind === "shape" && el.shape === "ellipse" ? "50%" : undefined }}>
            <div className="eh" style={{ color: el.color }} onPointerDown={e => start(e, el, "move")}>
              <span>{label}</span>
              {el.kind === "text" && <select value={el.head ?? 0} onPointerDown={e => e.stopPropagation()} onChange={e => upd(el.id, { head: Number(e.target.value) as El["head"] })}><option value={0}>本文</option><option value={1}>見出し1</option><option value={2}>見出し2</option><option value={3}>見出し3</option></select>}
              {el.kind === "shape" && <select value={el.shape} onPointerDown={e => e.stopPropagation()} onChange={e => upd(el.id, { shape: e.target.value as El["shape"] })}><option value="rect">四角</option><option value="ellipse">丸</option></select>}
              <input type="color" value={el.color} onPointerDown={e => e.stopPropagation()} onChange={e => upd(el.id, { color: e.target.value })} aria-label="色" />
              <button onPointerDown={e => e.stopPropagation()} onClick={() => onChange(els.filter(x => x.id !== el.id))} aria-label="削除">×</button>
            </div>
            {el.kind === "frame" && el.ft === "word" && (
              <div className="wl">{(el.words ?? []).map((w, i) => (
                <div className="wr" key={i}><input placeholder="用語" value={w.term} onChange={e => upd(el.id, { words: el.words!.map((x, j) => j === i ? { ...x, term: e.target.value } : x) })} />
                  <input placeholder="意味" value={w.meaning} onChange={e => upd(el.id, { words: el.words!.map((x, j) => j === i ? { ...x, meaning: e.target.value } : x) })} />
                  <button onClick={() => upd(el.id, { words: el.words!.filter((_, j) => j !== i) })} aria-label="この単語を消す">×</button></div>))}
                <button className="btn sm" onClick={() => upd(el.id, { words: [...(el.words ?? []), { term: "", meaning: "" }], h: el.h + 28 })}>＋ 単語</button></div>)}
            {(el.kind === "text" || (el.kind === "frame" && el.ft !== "word")) && <textarea className={`h${el.head ?? 0}`} value={el.text} placeholder={el.kind === "text" ? "文字を入力" : "ここに書く"} onChange={e => upd(el.id, { text: e.target.value })} />}
            {el.kind === "arrow" && <svg width="100%" height={el.h - 24} viewBox={`0 0 ${el.w} ${el.h - 24}`} preserveAspectRatio="none"><line x1="4" y1="50%" x2={el.w - 14} y2="50%" stroke={el.color} strokeWidth="3" /><polygon points={`${el.w - 14},${(el.h - 24) / 2 - 7} ${el.w - 2},${(el.h - 24) / 2} ${el.w - 14},${(el.h - 24) / 2 + 7}`} fill={el.color} /></svg>}
            <span className="rs" onPointerDown={e => start(e, el, "size")} />
          </div>);
      })}
    </div>);
}
