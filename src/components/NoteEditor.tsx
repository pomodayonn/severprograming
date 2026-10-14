// まとめノート：contenteditable。枠(ブロック)・見出し・目次・全画面・カーソル位置への挿入。
// 本番で TipTap / ProseMirror に載せ替えるなら、このファイルだけ差し替えればよい。
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Item } from "../types";
import { useStore } from "../state/store";
import { BLK, blkHtml, toHtml } from "../lib/logic";
import { Icon } from "./Icon";
import { toast } from "./toast";

let lastRange: Range | null = null; // 最後にノートの中にあったカーソル位置

function insertAtCursor(ed: HTMLElement, html: string) {
  const sel = getSelection(); if (!sel) return;
  ed.focus();
  if (lastRange && ed.contains(lastRange.startContainer)) { sel.removeAllRanges(); sel.addRange(lastRange); }
  else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  document.execCommand("insertHTML", false, html);
}

export function NoteEditor({ sid, it }: { sid: string; it: Item }) {
  const { dispatch } = useStore();
  const ed = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [full, setFull] = useState(false);
  const [toc, setToc] = useState<{ n: number; lv: string; text: string }[]>([]);
  const [cur, setCur] = useState(-1);
  const [count, setCount] = useState(0);

  const heads = () => Array.from(ed.current?.querySelectorAll<HTMLElement>("h1, h2, h3") ?? []);
  const updateCur = () => { let c = -1; heads().forEach((h, n) => { if (h.getBoundingClientRect().top <= 150) c = n; }); setCur(c); };
  const refresh = () => {
    setToc(heads().map((h, n) => ({ n, lv: h.tagName[1], text: h.textContent?.trim() || "（無題）" })));
    setCount((ed.current?.innerText ?? "").replace(/\s/g, "").length); updateCur();
  };
  /** 保存。mark=true のとき、カーソル位置に見えないしるし(#cmark)を残す → AIの結果をそこへ入れられる */
  const commit = (el: HTMLElement, mark: boolean) => {
    let m: HTMLElement | null = null;
    if (mark && lastRange && el.contains(lastRange.startContainer)) {
      el.querySelector("#cmark")?.remove(); m = document.createElement("span"); m.id = "cmark";
      const r = lastRange.cloneRange(); r.collapse(true); r.insertNode(m);
    }
    const noteHtml = el.innerHTML, note = el.innerText; m?.remove();
    dispatch({ t: "patch", s: sid, i: it.id, patch: { noteHtml, note } });
  };
  const later = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (ed.current) { commit(ed.current, false); toast("自動保存したよ"); } }, 900); };

  useLayoutEffect(() => {
    const el = ed.current!; el.innerHTML = it.noteHtml || toHtml(it.note) || "<p><br></p>"; refresh();
    document.execCommand("defaultParagraphSeparator", false, "p");
    return () => commit(el, true); // タブ/項目を離れるとき
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const f = () => { const sel = getSelection(); if (ed.current && sel?.rangeCount && ed.current.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    document.addEventListener("selectionchange", f); document.addEventListener("scroll", updateCur, true); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("selectionchange", f); document.removeEventListener("scroll", updateCur, true); document.removeEventListener("keydown", k); };
  }, []);
  useEffect(() => { document.body.classList.toggle("nofs", full); return () => document.body.classList.remove("nofs"); }, [full]);

  const cmd = (c: string, v?: string) => (e: MouseEvent) => { e.preventDefault(); document.execCommand(c, false, v); setTimeout(refresh, 0); };
  const blk = (k: string) => (e: MouseEvent) => { e.preventDefault(); if (ed.current) insertAtCursor(ed.current, blkHtml(k)); later(); };
  const jump = (n: number) => {
    const h = heads()[n], sel = getSelection(); if (!h || !sel) return;
    h.scrollIntoView({ behavior: "smooth", block: "start" });
    const r = document.createRange(); r.selectNodeContents(h); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); ed.current?.focus({ preventScroll: true });
  };
  /** 行頭で「# 」「## 」「### 」→ 見出し（半角で打ったとき） */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== " " || e.nativeEvent.isComposing) return;
    const sel = getSelection(), nd = sel?.anchorNode; if (!sel || !nd || !ed.current?.contains(nd)) return;
    const blkEl = (nd.nodeType === 3 ? nd.parentElement : (nd as Element))?.closest("p, div, h1, h2, h3");
    const m = blkEl && blkEl !== ed.current && !blkEl.closest(".bb") ? /^(#{1,3})$/.exec((blkEl.textContent || "").trim()) : null;
    if (!blkEl || !m) return;
    e.preventDefault(); blkEl.innerHTML = "<br>";
    const r = document.createRange(); r.setStart(blkEl, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand("formatBlock", false, "h" + m[1].length); setTimeout(refresh, 0);
  };

  return (
    <div className={"editor" + (full ? " full" : "")}>
      <div className="tbar">
        <button onMouseDown={cmd("bold")} title="太字"><b>B</b></button><button onMouseDown={cmd("italic")} title="斜体"><i>I</i></button><button onMouseDown={cmd("underline")} title="下線"><u>U</u></button>
        {["h1", "h2", "h3"].map((h, k) => <button key={h} onMouseDown={cmd("formatBlock", h)} title={`見出し${k + 1}`}>H{k + 1}</button>)}
        <button onMouseDown={cmd("formatBlock", "p")} title="本文">本文</button>
        <button onMouseDown={cmd("insertUnorderedList")} title="箇条書き"><Icon n="list" s={16} /></button><button onMouseDown={cmd("insertOrderedList")} title="番号リスト"><Icon n="list-ordered" s={16} /></button>
        <span className="vsep" />
        {Object.keys(BLK).map(k => <button key={k} className="bk" onMouseDown={blk(k)} title={`${BLK[k].n}の枠をカーソルの位置に入れる`}>{BLK[k].n}</button>)}
        <button onMouseDown={cmd("undo")} title="元に戻す"><Icon n="undo-2" s={16} /></button><button onMouseDown={cmd("redo")} title="やり直す"><Icon n="redo-2" s={16} /></button>
        <span className="sp" /><span className="mute">{count}文字</span>
        <button onClick={() => { if (ed.current) { commit(ed.current, false); dispatch({ t: "attempt", s: sid, i: it.id, a: { at: Date.now(), kind: "note" } }); toast("保存したよ"); } }}>保存</button>
        <button onClick={() => window.print()} title="PDFにする（印刷）"><Icon n="printer" s={16} /></button>
        <button className="pri" onClick={() => setFull(!full)}>{full ? "全画面を閉じる（Esc）" : "全画面"}</button>
      </div>
      <aside className="toc" aria-label="見出しの目次">
        {toc.map(t => <button key={t.n} className={`t t${t.lv}` + (cur === t.n ? " on" : "")} onClick={() => jump(t.n)}>{t.text}</button>)}
      </aside>
      <div className="sheetwrap">
        <div id="note" ref={ed} className="sheet" contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="まとめノート"
          data-ph="講義で聞いたこと、自分の言葉でまとめよう" onInput={() => { refresh(); later(); }} onKeyDown={onKeyDown} />
      </div>
    </div>
  );
}
