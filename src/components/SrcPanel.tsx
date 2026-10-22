import { useState } from "react";
import type { Item } from "../types";
import { useStore } from "../state/store";
import { ai, type AIInput } from "../services/ai";
import { ocr } from "../services/ocr";
import { blkHtml, esc, placeHtml, qaOf, toHtml } from "../lib/logic";
import { Icon } from "./Icon";

/** 端末の容量を抑えるため、縮小して保存 */
function shrink(f: File): Promise<string> {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 900 / Math.max(im.width, im.height)), c = document.createElement("canvas");
        c.width = im.width * k; c.height = im.height * k; c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", .6));
      };
      im.src = r.result as string;
    };
    r.readAsDataURL(f);
  });
}

export function SrcPanel({ sid, it }: { sid: string; it: Item }) {
  const { dispatch } = useStore();
  const [text, setText] = useState(it.srcText);
  const [busy, setBusy] = useState(""); const [notice, setNotice] = useState(""); const [conf, setConf] = useState<number | null>(null);
  const patch = (p: Partial<Item>) => dispatch({ t: "patch", s: sid, i: it.id, patch: p });
  const input = (): AIInput => ({ title: it.title, text: text || it.note, images: it.sources.map(x => x.url) });
  const hist = () => [...it.history, { at: Date.now(), kind: "note" as const }];
  const addFiles = async (files: FileList | null) => {
    if (!files) return; const add: Item["sources"] = [];
    for (const f of Array.from(files)) add.push({ url: await shrink(f), at: Date.now() });
    patch({ sources: [...it.sources, ...add], srcText: text });
  };
  const run = async (kind: "org" | "sum" | "q") => {
    setBusy(kind); patch({ srcText: text });
    if (kind === "org") {
      const bs = await ai.organize(input());
      if (bs.length) { patch({ ...placeHtml(it, bs.map(b => blkHtml(b.k, esc(b.text))).join("")), srcText: text, history: hist() }); dispatch({ t: "tab", tab: "note" }); setNotice(""); }
      else setNotice("枠に分ける文字がないよ。「資料の文字」に写真の内容を入れてね。");
    } else if (kind === "sum") {
      const out = await ai.summarize(input());
      if (out) { patch({ ...placeHtml(it, blkHtml("m", toHtml(out))), srcText: text, history: hist() }); dispatch({ t: "tab", tab: "note" }); setNotice(""); }
      else setNotice("まとめる文字がまだないよ。「資料の文字」に写真の内容を入れてね。");
    } else {
      const own = qaOf(it), qs = own.length ? own : await ai.questions(input());
      if (qs.length) { patch({ questions: qs }); dispatch({ t: "tab", tab: "test" }); setNotice(""); }
      else setNotice("問題にする文字がまだないよ。「資料の文字」に写真の内容を入れてね。");
    }
    setBusy("");
  };
  const readImages = async () => {
    setBusy("ocr"); const r = await ocr.read(it.sources.map(x => x.url));
    if (r.text) setText(t => (t ? t + "\n" : "") + r.text);
    setConf(r.confidence); setBusy("");
  };
  return (<>
    <div className="ops">
      <label className="btn"><Icon n="camera" s={16} /> 撮影<input type="file" accept="image/*" capture="environment" hidden onChange={e => addFiles(e.target.files)} /></label>
      <label className="btn"><Icon n="image-plus" s={16} /> アップロード<input type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} /></label>
    </div>
    <div className="thumbs">{it.sources.map((x, k) => (
      <figure key={k}><img src={x.url} alt={`資料${k + 1}`} /><button aria-label={`資料${k + 1}を削除`} onClick={() => patch({ sources: it.sources.filter((_, j) => j !== k) })}>×</button></figure>))}
      {!it.sources.length && <p className="mute">教科書・板書・配布プリントを撮るか、画像を選んでね。</p>}</div>
    <div className="ops"><button disabled={!it.sources.length || !!busy} onClick={readImages}>{busy === "ocr" ? "読み取り中…" : "写真から文字を読み取る"}</button></div>
    {conf !== null && conf < 0.8 && (
      <div className="ocrwarn"><b>読み取り精度 {Math.round(conf * 100)}%（低めだよ）</b><p>うまく読めていないかも。こう試してみて：</p>
        <ul><li>明るい場所で、真上から1ページずつ撮る</li><li>影や反射を避けて、文字を大きく写す</li></ul>
        <div className="ops"><button onClick={() => document.querySelector<HTMLInputElement>("input[capture]")?.click()}>撮り直す</button>
          <button onClick={() => document.getElementById("stext")?.focus()}>文字欄を手で直す</button></div></div>)}
    <label className="lbl" htmlFor="stext">資料の文字（写真の内容を入れてね。自動で読み取るのは今後！）</label>
    <textarea id="stext" value={text} onChange={e => setText(e.target.value)} onBlur={() => patch({ srcText: text })} />
    {notice && <p className="notice">{notice}</p>}
    <div className="ops">
      <button disabled={!!busy} className="pri" onClick={() => run("org")}>{busy === "org" ? "整理中…" : "AIで枠に整理（カーソル位置へ）"}</button>
      <button disabled={!!busy} onClick={() => run("sum")}>{busy === "sum" ? "要約中…" : "AIにまとめてもらう"}</button>
      <button disabled={!!busy} className="pri" onClick={() => run("q")}>{busy === "q" ? "作成中…" : "AIに問題を作ってもらう"}</button>
    </div>
  </>);
}
