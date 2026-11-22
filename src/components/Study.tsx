// G004 学習画面：左（階層／部品）・真ん中（ノート）・右（関連図／目次）の3列
// 11/12：学習項目の追加・名前の編集・削除・前提項目の設定を Controller → LearningItemManager 経由にした（A）。
// 11/12：ノートの「保存」は state/app.tsx の save() から Controller → NoteManager に送る（A）
// 11/21：科目・学習項目・ノートは useApp の subjects（Manager から読んだもの）を見る。成功したら reload() で読み直す。
// 11/21：資料の追加・文字起こし・表示も Controller → MaterialManager 経由にした。資料の一覧は useApp の materials を見る
//
// 【このファイルで何が起きているか】
// 学習画面（G004）です。いちばん大きな画面で、3列に分かれている。
// ・左  ：科目と学習項目の一覧（階層）／ノートに置く部品（部品）。学習項目の追加・名前の編集・削除・前提項目の設定、資料の追加
// ・真ん中：ノート（NoteCanvas.tsx）。下に「保存」「AIでまとめる」「テスト一覧」「模擬テスト」のボタン
// ・右  ：関連図（RelationGraph.tsx）／目次
// ノートを書いている間は drafts（下書き）に入れておき、「保存」を押すと app.tsx の save() で本当に保存する
// ボタンの流れ：画面 → controller.handleRequest("G004", イベントID) → LearningItemManager など → DAO → 端末に保存（→ Neon）
// 11/21 道B：科目・学習項目・前提項目・ノートの部品・資料は beans のまま使う（lib/select.ts の関数で探す）
import { useMemo, useState } from "react";
import { Redirect, useApp } from "../state/app";
import type { FrameType } from "../types";
import { FT, bottomY, newPart } from "../lib/logic";
import { itemsOf, partsOf, prereqIdsOf } from "../lib/select";
import { controller } from "../controller/Controller";
import type { LearningItem } from "../beans/LearningItem";
import type { NotePart } from "../beans/NotePart";
import type { Material } from "../beans/Material";
import type { TranscribeResult } from "../managers/MaterialManager";
import { PartType } from "../enums/PartType";
import { NoteCanvas } from "./NoteCanvas";
import { RelationGraph } from "./RelationGraph";
import { Tree, Header } from "./Shell";
import { Viewer, useMaterialContent } from "./Material";
import { toast } from "./toast";

function SideMaterial({ id }: { id: string | null }) {
  const { materials } = useApp(); const m = materials.find(x => x.materialId === id); const v = useMaterialContent("G004", m?.materialId);
  return <div className="vbox">{m ? <Viewer type={m.fileType} v={v} /> : <p className="mute">資料を選ぶと、ここに表示します。</p>}</div>;
}
export function Study() {
  const { materials, subjects, items, prerequisites, notes, tests, reload, route, nav, go, drafts, setDraft, ask, askName, save, account } = useApp();
  const subject = subjects.find(s => s.subjectId === route.subjectId);
  const its = useMemo(() => itemsOf(items, route.subjectId), [items, route.subjectId]); // この科目の学習項目（同じ間は関連図を描き直さない）
  const [ltab, setL] = useState<"tree" | "parts">("tree"), [rtab, setR] = useState<"graph" | "toc">("graph"), [mode, setMode] = useState<"note" | "side">("note");
  const [full, setFull] = useState(false), [ft, setFt] = useState<FrameType>("word"), [ref, setRef] = useState<string | null>(null), [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState(""), [prog, setProg] = useState<number | null>(null), [pre, setPre] = useState<string[] | null>(null), [preMsg, setPreMsg] = useState("");
  const sid = account?.studentId ?? "";
  if (!subject || !account) return <Redirect to={{ s: "G003" }} />;
  const item: LearningItem | undefined = its.find(i => i.itemId === route.itemId) ?? its[0];
  // ノートの部品：下書き（まだ保存していない変更）があれば下書き、なければ保存してあるノート
  const parts: NotePart[] | null = item ? (drafts[item.itemId] ?? [...partsOf(notes, item.itemId)]) : null;
  const mats = item ? materials.filter(m => m.itemId === item.itemId) : [];
  const setParts = (ps: NotePart[]) => item && setDraft(item.itemId, ps);
  const addPart = (type: PartType, f?: FrameType) => parts && setParts([...parts, newPart(type, bottomY(parts), f)]);
  const open = (id: string) => go({ s: "G004", subjectId: subject.subjectId, itemId: id });
  const addItem = async () => {
    const n = await askName("学習項目の追加"); if (!n) return;
    const r = await controller.handleRequest("G004", "addItem", { studentId: sid, subjectId: subject.subjectId, name: n });
    if (r.error) return toast(r.error);
    const b = r.data as LearningItem;
    await reload(); nav({ s: "G004", subjectId: subject.subjectId, itemId: b.itemId });
  };
  const rename = async () => {
    if (!item) return;
    const n = await askName("学習項目名の編集", item.itemName); if (!n) return;
    const r = await controller.handleRequest("G004", "renameItem", { itemId: item.itemId, name: n });
    if (r.error) return toast(r.error);
    await reload();
  };
  const del = async () => {
    if (!item || await ask("この学習項目のノート・資料・テストも削除されます", [{ label: "削除する", value: "ok", danger: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    const r = await controller.handleRequest("G004", "deleteItem", { itemId: item.itemId });
    if (r.error) return toast(r.error);
    setDraft(item.itemId, null); // 資料（ストレージ）は LearningItemManager.deleteItem が一緒に消す
    await reload();
    nav({ s: "G004", subjectId: subject.subjectId }); toast("学習項目を削除したよ");
  };
  const savePre = async () => {
    if (!item || !pre) return;
    const r = await controller.handleRequest("G004", "setPrerequisites", { itemId: item.itemId, prereqIds: pre });
    if (r.error) return setPreMsg(r.error); // 輪になるときは「前提項目が輪になるため設定できません」
    await reload(); setPre(null); setPreMsg("");
  };
  // 資料の追加：1つずつ Controller（G004:uploadMaterial）で保存し、画像・PDF なら続けて文字起こし（G004:transcribe）
  const upload = async (files: FileList | null) => {
    if (!files || !item) return; setMsg("");
    for (const f of Array.from(files)) {
      const u = await controller.handleRequest("G004", "uploadMaterial", { itemId: item.itemId }, { file: f });
      if (u.error) { setMsg(u.error); continue; } // 形式・大きさ・保存容量のエラー
      const m = u.data as Material;
      if (m.fileType !== "text") { // 文字起こし：進み具合を小さく表示。失敗しても画面は移らない（資料は保存済み）
        setProg(0);
        const t = await controller.handleRequest("G004", "transcribe", { materialId: m.materialId }, { listener: { onProgress: setProg } });
        if (t.error) setMsg(t.error);
        else { const { failedPages } = t.data as TranscribeResult; if (failedPages.length) setMsg(`読み取れなかったページがあります（${failedPages.join("、")}）。「修正」で自分で直せます`); }
        setProg(null);
      }
      await reload(); // 1つ終わるごとに一覧に出す
    }
  };
  const doSave = async () => { if (item && drafts[item.itemId]) { if (await save(item.itemId)) toast("保存したよ"); } else toast("変更はありません"); };
  const openMat = (id: string) => go({ s: "G005", subjectId: subject.subjectId, itemId: item?.itemId, materialId: id });
  const toc = parts ? controller.tableOfContents(parts) : []; // 見出しと枠を上から順に（NoteManager.getTableOfContents）
  const jump = (id: string) => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const matSelect = <select className="inp" style={{ margin: 0 }} value={ref ?? ""} onChange={e => setRef(e.target.value || null)}><option value="">資料を選ぶ…</option>{mats.map(m => <option key={m.materialId} value={m.materialId}>{m.fileName}</option>)}</select>;
  const canvas = parts ? <NoteCanvas parts={parts} onChange={setParts} /> : null;
  const extra = (id: string) => id === item?.itemId ? (<><div className="ind">ノート</div><div className="ind">ストレージ</div>
    {mats.map(m => <div className="ind mat" key={m.materialId} onClick={() => openMat(m.materialId)}>{m.fileName}</div>)}
    <div className="ind click" onClick={() => go({ s: "G011", subjectId: subject.subjectId, itemId: id })}>テスト（{tests.filter(t => t.itemId === id).length}）</div></>) : null;
  return (<div className="app"><Header />
    <div className="cols">
      <aside className="lf">
        <div className="tabs"><button className={"chip" + (ltab === "tree" ? " on" : "")} onClick={() => setL("tree")}>階層</button><button className={"chip" + (ltab === "parts" ? " on" : "")} onClick={() => setL("parts")}>ノートの部品</button></div>
        {ltab === "tree" ? (<>
          <Tree heading="科目一覧" extra={extra} />
          {prog !== null && <div className="mute" style={{ margin: "6px 0" }}>文字起こし中… {prog}%</div>}{msg && <div className="err">{msg}</div>}
          {/* 11/17：操作ボタンを「学習項目」「資料」のまとまりに分け、大きく押しやすくした */}
          <div className="sec"><div className="sh">学習項目{item && <b>{item.itemName}</b>}</div>
            <button className="btn pri wide" onClick={addItem}>＋ 学習項目を追加</button>
            <div className="grid2"><button className="btn sm" disabled={!item} onClick={rename}>名前を変更</button><button className="btn sm danger" disabled={!item} onClick={del}>削除</button></div>
            <button className="btn sm wide" disabled={!item || its.length < 2} onClick={() => { setPre(prereqIdsOf(prerequisites, item!.itemId)); setPreMsg(""); }}>前提項目の設定</button></div>
          <div className="sec"><div className="sh">資料</div>
            <label className={"btn wide" + (item ? "" : " disabled")} aria-disabled={!item} style={item ? undefined : { opacity: .45, cursor: "not-allowed" }}>＋ 資料の追加<input hidden type="file" multiple accept="image/*,application/pdf,text/plain,.txt" disabled={!item} onChange={e => { upload(e.target.files); e.target.value = ""; }} /></label>
            <span className="mute">画像・PDF・テキスト（1件20MBまで）。画像とPDFは文字起こしもします</span></div>
          {pre && item && <div className="pop"><h3>前提項目の設定</h3>
            {its.filter(i => i.itemId !== item.itemId).map(i => <label className="ck" key={i.itemId}><input type="checkbox" checked={pre.includes(i.itemId)} onChange={e => setPre(e.target.checked ? [...pre, i.itemId] : pre.filter(p => p !== i.itemId))} />{i.itemName}</label>)}
            {preMsg && <div className="err">{preMsg}</div>}<div className="row"><button className="btn sm line" onClick={() => setPre(null)}>やめる</button><button className="btn sm pri" onClick={savePre}>確定</button></div></div>}
        </>) : (<div className="col">
          <div className="sec"><div className="sh">枠（種類を選んで置く）</div>
            <select className="inp" style={{ margin: 0 }} value={ft} onChange={e => setFt(e.target.value as FrameType)}>{(Object.keys(FT) as FrameType[]).map(k => <option key={k} value={k}>{FT[k].n}</option>)}</select>
            <button className="btn pri wide" disabled={!parts} onClick={() => addPart(PartType.FRAME, ft)}>＋ 枠を置く</button></div>
          <div className="sec"><div className="sh">そのほかの部品</div>
            <div className="grid3"><button className="btn sm" disabled={!parts} onClick={() => addPart(PartType.TEXT)}>文字</button><button className="btn sm" disabled={!parts} onClick={() => addPart(PartType.SHAPE)}>図形</button><button className="btn sm" disabled={!parts} onClick={() => addPart(PartType.ARROW)}>矢印</button></div></div>
          <p className="mute">置いた部品はドラッグで動かし、右下で大きさ、上の色ボタンで色を変えます。文字は「見出し」に変えられます。</p></div>)}
      </aside>
      <main className="ct">{item && parts ? (<>
        <div className="tabs"><button className={"chip" + (mode === "note" ? " on" : "")} onClick={() => setMode("note")}>ノート</button><button className={"chip" + (mode === "side" ? " on" : "")} onClick={() => setMode("side")}>資料と並べる</button><button className="chip" onClick={() => setFull(true)}>全画面</button><span className="sp" /><b>{item.itemName}</b><span className="mute">　{drafts[item.itemId] ? "未保存の変更あり" : "保存済み"}</span></div>
        {mode === "side" ? <div className="two"><div>{canvas}</div><div>{matSelect}<SideMaterial id={ref} /></div></div> : canvas}
        <div className="bar2 stick"><button className="btn pri lg" onClick={doSave}>保存</button>
          <span style={{ position: "relative" }}><button className="btn" onClick={() => mats.length === 0 ? toast("資料がまだありません") : mats.length === 1 ? openMat(mats[0].materialId) : setMenu(!menu)}>資料</button>
            {menu && <div className="pop" style={{ position: "absolute", bottom: "110%", left: 0, minWidth: 180, zIndex: 5 }}>{mats.map(m => <div key={m.materialId} className="ind mat" style={{ margin: "3px 0" }} onClick={() => openMat(m.materialId)}>{m.fileName}</div>)}</div>}</span>
          <button className="btn ai" onClick={() => go({ s: "G007", subjectId: subject.subjectId, itemId: item.itemId, purpose: "summary" })}>AIでまとめる</button>
          <button className="btn" onClick={() => go({ s: "G011", subjectId: subject.subjectId, itemId: item.itemId })}>テスト一覧</button>
          <button className="btn" onClick={() => go({ s: "G008", subjectId: subject.subjectId, itemId: item.itemId })}>模擬テスト</button></div>
      </>) : <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ってみよう。</p>}</main>
      <aside className="rt">
        <div className="tabs"><button className={"chip" + (rtab === "graph" ? " on" : "")} onClick={() => setR("graph")}>関連図</button><button className={"chip" + (rtab === "toc" ? " on" : "")} onClick={() => setR("toc")}>目次</button></div>
        {rtab === "graph" ? <RelationGraph items={its} prerequisites={prerequisites} selId={item?.itemId} onOpen={open} /> : (<div className="col">{toc.map(e => <button key={e.partId} className="toc" onClick={() => jump(e.partId)}>{e.label}</button>)}{!toc.length && <p className="mute">見出しと枠がまだありません。</p>}</div>)}
      </aside>
    </div>
    {full && parts && <div className="fs"><div className="row" style={{ marginBottom: 8 }}><b>{item?.itemName}</b><span className="sp" />{matSelect}<button className="btn pri" onClick={doSave}>保存</button><button className="btn line" onClick={() => setFull(false)}>全画面を閉じる</button></div>
      <div className="body" style={{ gridTemplateColumns: ref ? "1fr 1fr" : "1fr" }}><div>{canvas}</div>{ref && <SideMaterial id={ref} />}</div></div>}
  </div>);
}
