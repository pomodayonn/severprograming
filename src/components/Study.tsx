// G004 学習画面：左（階層／部品）・真ん中（ノート）・右（関連図／目次）の3列
import { useState } from "react";
import { useApp } from "../state/app";
import type { FrameType, Item, MaterialMeta } from "../types";
import { FT, MAX_FILE, bottomY, newEl, txtName, uid, wouldCycle } from "../lib/logic";
import { delBlob, putBlob } from "../services/db";
import { transcribe } from "../services/ocr";
import { NoteCanvas } from "./NoteCanvas";
import { RelationGraph } from "./RelationGraph";
import { Tree, Header } from "./Shell";
import { Viewer, useBlob } from "./Material";
import { toast } from "./toast";

function SideMaterial({ id }: { id: string | null }) {
  const { data, account } = useApp(); const m = data.materials.find(x => x.id === id); const v = useBlob(m && account ? `${account.id}:${m.id}` : undefined);
  return <div className="vbox">{m ? <Viewer type={m.type} v={v} /> : <p className="mute">資料を選ぶと、ここに表示します。</p>}</div>;
}
export function Study() {
  const { data, setData, route, nav, go, drafts, setDraft, ask, askName, save, account } = useApp();
  const subject = data.subjects.find(s => s.id === route.subjectId);
  const [ltab, setL] = useState<"tree" | "parts">("tree"), [rtab, setR] = useState<"graph" | "toc">("graph"), [mode, setMode] = useState<"note" | "side">("note");
  const [full, setFull] = useState(false), [ft, setFt] = useState<FrameType>("word"), [ref, setRef] = useState<string | null>(null), [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState(""), [prog, setProg] = useState<number | null>(null), [pre, setPre] = useState<string[] | null>(null), [preMsg, setPreMsg] = useState("");
  if (!subject || !account) { setTimeout(() => nav({ s: "G003" }), 0); return null; }
  const item: Item | undefined = subject.items.find(i => i.id === route.itemId) ?? subject.items[0];
  const note = item ? (drafts[item.id] ?? item.note) : null;
  const mats = item ? data.materials.filter(m => m.itemId === item.id) : [];
  const setEls = (els: NonNullable<typeof note>["els"]) => item && note && setDraft(item.id, { ...note, els });
  const addEl = (k: Parameters<typeof newEl>[0], f?: FrameType) => note && setEls([...note.els, newEl(k, bottomY(note.els), f)]);
  const patchItems = (f: (items: Item[]) => Item[]) => setData(d => ({ ...d, subjects: d.subjects.map(s => s.id === subject.id ? { ...s, items: f(s.items) } : s) }));
  const open = (id: string) => go({ s: "G004", subjectId: subject.id, itemId: id });
  const addItem = async () => { const n = await askName("学習項目の追加"); if (!n) return; const it: Item = { id: uid(), name: n, prereqs: [], note: { els: [], savedAt: 0 } }; patchItems(a => [...a, it]); nav({ s: "G004", subjectId: subject.id, itemId: it.id }); };
  const rename = async () => { if (!item) return; const n = await askName("学習項目名の編集", item.name); if (n) patchItems(a => a.map(i => i.id === item.id ? { ...i, name: n } : i)); };
  const del = async () => {
    if (!item || await ask("この学習項目のノート・資料・テストも削除されます", [{ label: "削除する", value: "ok", primary: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    mats.forEach(m => delBlob(`${account.id}:${m.id}`)); setDraft(item.id, null);
    patchItems(a => a.filter(i => i.id !== item.id).map(i => ({ ...i, prereqs: i.prereqs.filter(p => p !== item.id) })));
    setData(d => ({ ...d, materials: d.materials.filter(m => m.itemId !== item.id), tests: d.tests.filter(t => t.itemId !== item.id) }));
    nav({ s: "G004", subjectId: subject.id }); toast("学習項目を削除したよ");
  };
  const savePre = () => {
    if (!item || !pre) return;
    if (pre.some(p => wouldCycle(subject.items, item.id, p))) return setPreMsg("前提項目が輪になるため設定できません");
    patchItems(a => a.map(i => i.id === item.id ? { ...i, prereqs: pre } : i)); setPre(null); setPreMsg("");
  };
  const upload = async (files: FileList | null) => {
    if (!files || !item) return; setMsg(""); const names = mats.map(m => m.name);
    for (const f of Array.from(files)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const type = f.type.startsWith("image/") ? "image" : f.type === "application/pdf" || ext === "pdf" ? "pdf" : f.type.startsWith("text/") || ext === "txt" ? "text" : null;
      if (!type) { setMsg("取り込めない形式です（画像・PDF・テキストだけ）"); continue; }
      if (f.size > MAX_FILE) { setMsg("ファイルが大きすぎます（1件20MBまで）"); continue; }
      const id = uid(); try { await putBlob(`${account.id}:${id}`, type === "text" ? await f.text() : f); } catch { setMsg("保存容量が足りません"); continue; }
      names.push(f.name); const add: MaterialMeta[] = [{ id, itemId: item.id, name: f.name, type, size: f.size, at: Date.now() }];
      if (type !== "text") { // 文字起こし：進み具合を小さく表示。失敗しても画面は移らない
        try {
          setProg(0); const r = await transcribe(f, type, setProg); const tid = uid(), tn = txtName(f.name.replace(/\.[^.]+$/, ""), names); names.push(tn);
          await putBlob(`${account.id}:${tid}`, r.text); add.push({ id: tid, itemId: item.id, name: tn, type: "transcript", size: r.text.length, srcId: id, at: Date.now() });
          if (r.failedPages.length) setMsg(`読み取れなかったページがあります（${r.failedPages.join("、")}）。「修正」で自分で直せます`);
        } catch { setMsg("文字起こしに失敗しました。自分で文字を入力するか、もう一度アップロードしてください"); }
        setProg(null);
      }
      setData(d => ({ ...d, materials: [...d.materials, ...add] }));
    }
  };
  const doSave = () => { if (item && drafts[item.id]) { save(item.id); toast("保存したよ"); } else toast("変更はありません"); };
  const openMat = (id: string) => go({ s: "G005", subjectId: subject.id, itemId: item?.id, materialId: id });
  const toc = note ? [...note.els].filter(e => (e.kind === "text" && (e.head ?? 0) > 0) || e.kind === "frame").sort((a, b) => a.y - b.y) : [];
  const jump = (id: string) => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const matSelect = <select className="inp" style={{ margin: 0 }} value={ref ?? ""} onChange={e => setRef(e.target.value || null)}><option value="">資料を選ぶ…</option>{mats.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>;
  const canvas = note ? <NoteCanvas els={note.els} onChange={setEls} /> : null;
  const extra = (id: string) => id === item?.id ? (<><div className="ind">ノート</div><div className="ind">ストレージ</div>
    {mats.map(m => <div className="ind mat" key={m.id} onClick={() => openMat(m.id)}>{m.name}</div>)}
    <div className="ind click" onClick={() => go({ s: "G011", subjectId: subject.id, itemId: id })}>テスト（{data.tests.filter(t => t.itemId === id).length}）</div></>) : null;
  return (<div className="app"><Header />
    <div className="cols">
      <aside className="lf">
        <div className="tabs"><button className={"chip" + (ltab === "tree" ? " on" : "")} onClick={() => setL("tree")}>階層</button><button className={"chip" + (ltab === "parts" ? " on" : "")} onClick={() => setL("parts")}>部品</button></div>
        {ltab === "tree" ? (<>
          <Tree heading="科目一覧" extra={extra} />
          {prog !== null && <div className="mute" style={{ margin: "6px 0" }}>文字起こし中… {prog}%</div>}{msg && <div className="err">{msg}</div>}
          <div className="col" style={{ marginTop: 10 }}>
            <label className="btn sm">資料の追加<input hidden type="file" multiple accept="image/*,application/pdf,text/plain,.txt" disabled={!item} onChange={e => { upload(e.target.files); e.target.value = ""; }} /></label>
            <button className="btn sm" onClick={addItem}>＋ 学習項目を追加</button>
            <div className="row"><button className="btn sm line" disabled={!item} onClick={rename}>名前の編集</button><button className="btn sm line" disabled={!item} onClick={del}>削除</button></div>
            <button className="btn sm line" disabled={!item || subject.items.length < 2} onClick={() => { setPre(item!.prereqs); setPreMsg(""); }}>前提項目の設定</button></div>
          {pre && item && <div className="pop"><h3>前提項目の設定</h3>
            {subject.items.filter(i => i.id !== item.id).map(i => <label className="ck" key={i.id}><input type="checkbox" checked={pre.includes(i.id)} onChange={e => setPre(e.target.checked ? [...pre, i.id] : pre.filter(p => p !== i.id))} />{i.name}</label>)}
            {preMsg && <div className="err">{preMsg}</div>}<div className="row"><button className="btn sm line" onClick={() => setPre(null)}>やめる</button><button className="btn sm" onClick={savePre}>確定</button></div></div>}
        </>) : (<div className="col">
          <div className="row"><select className="inp" style={{ margin: 0, width: "auto" }} value={ft} onChange={e => setFt(e.target.value as FrameType)}>{(Object.keys(FT) as FrameType[]).map(k => <option key={k} value={k}>{FT[k].n}</option>)}</select><button className="btn sm" disabled={!note} onClick={() => addEl("frame", ft)}>枠を置く</button></div>
          <button className="btn line" disabled={!note} onClick={() => addEl("text")}>文字</button><button className="btn line" disabled={!note} onClick={() => addEl("shape")}>図形</button><button className="btn line" disabled={!note} onClick={() => addEl("arrow")}>矢印</button>
          <p className="mute">置いた部品はドラッグで動かし、右下で大きさ、上の色ボタンで色を変えます。文字は「見出し」に変えられます。</p></div>)}
      </aside>
      <main className="ct">{item && note ? (<>
        <div className="tabs"><button className={"chip" + (mode === "note" ? " on" : "")} onClick={() => setMode("note")}>ノート</button><button className={"chip" + (mode === "side" ? " on" : "")} onClick={() => setMode("side")}>資料と並べる</button><button className="chip" onClick={() => setFull(true)}>全画面</button><span className="sp" /><b>{item.name}</b><span className="mute">　{drafts[item.id] ? "未保存の変更あり" : "保存済み"}</span></div>
        {mode === "side" ? <div className="two"><div>{canvas}</div><div>{matSelect}<SideMaterial id={ref} /></div></div> : canvas}
        <div className="bar2 stick"><button className="btn" onClick={doSave}>保存</button>
          <span style={{ position: "relative" }}><button className="btn" onClick={() => mats.length === 0 ? toast("資料がまだありません") : mats.length === 1 ? openMat(mats[0].id) : setMenu(!menu)}>資料</button>
            {menu && <div className="pop" style={{ position: "absolute", bottom: "110%", left: 0, minWidth: 180, zIndex: 5 }}>{mats.map(m => <div key={m.id} className="ind mat" style={{ margin: "3px 0" }} onClick={() => openMat(m.id)}>{m.name}</div>)}</div>}</span>
          <button className="btn" onClick={() => go({ s: "G007", subjectId: subject.id, itemId: item.id, purpose: "summary" })}>AIでまとめる</button>
          <button className="btn" onClick={() => go({ s: "G011", subjectId: subject.id, itemId: item.id })}>テスト一覧</button>
          <button className="btn" onClick={() => go({ s: "G008", subjectId: subject.id, itemId: item.id })}>模擬テスト</button></div>
      </>) : <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ってみよう。</p>}</main>
      <aside className="rt">
        <div className="tabs"><button className={"chip" + (rtab === "graph" ? " on" : "")} onClick={() => setR("graph")}>関連図</button><button className={"chip" + (rtab === "toc" ? " on" : "")} onClick={() => setR("toc")}>目次</button></div>
        {rtab === "graph" ? <RelationGraph s={subject} selId={item?.id} onOpen={open} /> : (<div className="col">{toc.map(e => <button key={e.id} className="toc" onClick={() => jump(e.id)}>{e.kind === "frame" ? `${FT[e.ft!].n}　${(e.words?.[0]?.term ?? e.text).slice(0, 12)}` : `見出し${e.head}　${e.text.slice(0, 14)}`}</button>)}{!toc.length && <p className="mute">見出しと枠がまだありません。</p>}</div>)}
      </aside>
    </div>
    {full && note && <div className="fs"><div className="row" style={{ marginBottom: 8 }}><b>{item?.name}</b><span className="sp" />{matSelect}<button className="btn" onClick={doSave}>保存</button><button className="btn fill" onClick={() => setFull(false)}>全画面を閉じる</button></div>
      <div className="body" style={{ gridTemplateColumns: ref ? "1fr 1fr" : "1fr" }}><div>{canvas}</div>{ref && <SideMaterial id={ref} />}</div></div>}
  </div>);
}
