// G004 学習画面：左（階層／部品）・真ん中（ノート）・右（関連図／目次）の3列
// 11/12：学習項目の追加・名前の編集・削除・前提項目の設定を Controller → LearningItemManager 経由にした（A）。
// 11/12：ノートの「保存」は state/app.tsx の save() から Controller → NoteManager に送る（A）
// 11/21：科目・学習項目・ノートは useApp の subjects（Manager から読んだもの）を見る。成功したら reload() で読み直す。
// 11/21：資料の追加・文字起こし・表示も Controller → MaterialManager 経由にした。資料の一覧は useApp の materials を見る
//
// 【このファイルで何が起きているか】
// 学習画面（G004）です。いちばん大きな画面で、3列に分かれている。
// ・左  ：科目と学習項目の一覧（階層）／ノートに置く部品（部品）。学習項目の追加・名前の編集・削除・つながり（前提項目）の設定、資料の追加
// ・真ん中：ノート（NoteCanvas.tsx）。下に「保存」「AIでまとめる」「テスト一覧」「模擬テスト」のボタン
// ・右  ：関連図（RelationGraph.tsx）／目次
// ノートを書いている間は drafts（下書き）に入れておき、「保存」を押すと app.tsx の save() で本当に保存する
// ボタンの流れ：画面 → controller.handleRequest("G004", イベントID) → LearningItemManager など → DAO → 端末に保存（→ Neon）
// 11/21 道B：科目・学習項目・前提項目・ノートの部品・資料は beans のまま使う（lib/select.ts の関数で探す）
import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useApp } from "../state/app";
import type { FrameType } from "../types";
import { bottomY, newPart } from "../lib/logic";
import { itemsOf, partsOf } from "../lib/select";
import { emptyHistory, record, redo, undo, type History } from "../lib/history";
import { controller } from "../controller/Controller";
import type { LearningItem } from "../beans/LearningItem";
import type { NotePart } from "../beans/NotePart";
import type { Material } from "../beans/Material";
import type { TranscribeResult } from "../managers/MaterialManager";
import { PartType } from "../enums/PartType";
import { NoteCanvas } from "./NoteCanvas";
import { Tabs } from "./Tabs";
import { RelationGraph } from "./RelationGraph";
import { LinkDialog } from "./LinkDialog";
import { Cols, Tree, Header } from "./Shell";
import { Viewer, useMaterialContent } from "./Material";
import { toast } from "./toast";

/** 左・真ん中・右のタブ（値と、画面に出す名前） */
const MODES = [["note", "ノート"], ["side", "資料と並べる"]] as const;
const RTABS = [["graph", "関連図"], ["toc", "目次"]] as const;

function SideMaterial({ id }: { id: string | null }) {
  const { materials } = useApp(); const m = materials.find(x => x.materialId === id); const v = useMaterialContent("G004", m?.materialId);
  return <div className="vbox">{m ? <Viewer type={m.fileType} v={v} /> : <p className="mute">資料を選ぶと、ここに表示します。</p>}</div>;
}
export function Study() {
  const { materials, subjects, items, prerequisites, notes, tests, reload, route, nav, go, drafts, setDraft, ask, askName, save, account } = useApp();
  const subject = subjects.find(s => s.subjectId === route.subjectId);
  const its = useMemo(() => itemsOf(items, route.subjectId), [items, route.subjectId]); // この科目の学習項目（同じ間は関連図を描き直さない）
  const [rtab, setR] = useState<"graph" | "toc">("graph"), [mode, setMode] = useState<"note" | "side">("note");
  const [full, setFull] = useState(false), [ref, setRef] = useState<string | null>(null), [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState(""), [prog, setProg] = useState<number | null>(null), [linking, setLinking] = useState(false);
  const sid = account?.studentId ?? "";
  // 11/23：Ctrl＋S（Mac は ⌘＋S）でノートを保存する。ブラウザの「ページを保存」は出さない
  const saveKey = useRef<() => void>(() => {});
  // 11/23：ノートの「元に戻す」（Ctrl＋Z）・「やり直す」（Ctrl＋Y か Ctrl＋Shift＋Z）。履歴は学習項目ごとに持つ（lib/history.ts）
  const hist = useRef<Record<string, History<NotePart[]>>>({}), [, setTick] = useState(0);
  const undoKey = useRef<(back: boolean) => void>(() => {});
  const fullKey = useRef(false); fullKey.current = full;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 確認の窓（「保存していない変更があります」など）が出ている間は、うしろのノートを変えない（11/23 バグ修正）
      if (document.querySelector(".ov")) return;
      if (e.key === "Escape" && fullKey.current) { setFull(false); return; } // Esc で全画面を閉じる
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); saveKey.current(); return; }
      if (k !== "z" && k !== "y") return;
      // ノートの外の入力欄（名前の入力など）では、ブラウザのふつうの「元に戻す」にまかせる
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.closest("#note-canvas")) return;
      e.preventDefault(); undoKey.current(k === "z" && !e.shiftKey);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!subject || !account) return <Redirect to={{ s: "G003" }} />;
  const item: LearningItem | undefined = its.find(i => i.itemId === route.itemId) ?? its[0];
  // ノートの部品：下書き（まだ保存していない変更）があれば下書き、なければ保存してあるノート
  const parts: NotePart[] | null = item ? (drafts[item.itemId] ?? [...partsOf(notes, item.itemId)]) : null;
  const mats = item ? materials.filter(m => m.itemId === item.itemId) : [];
  const h = item ? hist.current[item.itemId] ?? emptyHistory<NotePart[]>() : null;
  const setParts = (ps: NotePart[]) => { if (!item || !parts) return; hist.current[item.itemId] = record(hist.current[item.itemId] ?? emptyHistory<NotePart[]>(), parts, Date.now()); setDraft(item.itemId, ps); };
  /** back が true なら元に戻す、false ならやり直す */
  const step = (back: boolean) => {
    if (!item || !parts || !h) return;
    const cur = hist.current[item.itemId] ?? h, r = back ? undo(cur, parts) : redo(cur, parts);
    if (!r) return toast(back ? "これより前には戻せません" : "やり直す変更はありません");
    hist.current[item.itemId] = r.h; setDraft(item.itemId, r.value); setTick(t => t + 1);
  };
  undoKey.current = step;
  /** 部品を置く（11/25 夕：ボタンはノートの上の並び（NoteCanvas の InsertBar）に移した）。置いた部品を返す */
  const addPart = (type: PartType, f?: FrameType) => { if (!parts) return; const n = newPart(type, bottomY(parts), f); setParts([...parts, n]); return n; };
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
  // 11/26：つながり（前に学ぶ・次に学ぶ）の窓の「確定」。うまくいかなかったらエラーの文を返し、窓は開いたまま
  const saveLinks = async (before: string[], after: string[]) => {
    if (!item) return;
    const r = await controller.handleRequest("G004", "setPrerequisites", { itemId: item.itemId, prereqIds: before, nextIds: after });
    if (r.error) return r.error; // 輪になるときは「前提項目が輪になるため設定できません…」
    await reload(); setLinking(false); toast("つながりを保存したよ");
  };
  const canLink = !!item && its.length >= 2;
  // 資料の追加：1つずつ Controller（G004:uploadMaterial）で保存し、画像・PDF なら続けて文字起こし（G004:transcribe）
  const upload = async (files: FileList | null) => {
    if (!files || !item) return; setMsg("");
    // 11/25 夕：同じ名前の資料がもうあるときは、追加する前に聞く（同じ画像を何回も入れてしまうのを防ぐ）
    const names = new Set(mats.map(m => m.fileName));
    for (const f of Array.from(files)) {
      if (names.has(f.name) && await ask(`同じ名前の資料「${f.name}」がもうあります。もう1つ追加しますか？`, [{ label: "追加する", value: "ok" }, { label: "やめる", value: "no" }]) !== "ok") continue;
      names.add(f.name);
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
    const doSave = async () => {
    if (!item || !drafts[item.itemId]) {
      toast("変更はありません");
      return;
    }

    const result = await save(item.itemId);

    if (result === "sync-ok") {
      toast("端末に保存しました（同期処理は正常終了）");
    } else if (result === "unconfirmed") {
      toast("端末に保存しました。クラウドへの同期を確認できませんでした");
    }
  };
  saveKey.current = () => { void doSave(); };
  const openMat = (id: string) => go({ s: "G005", subjectId: subject.subjectId, itemId: item?.itemId, materialId: id });
  const toc = parts ? controller.tableOfContents(parts) : []; // 見出しと枠を上から順に（NoteManager.getTableOfContents）
  const jump = (id: string) => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const matSelect = <select className="inp" style={{ margin: 0 }} value={ref ?? ""} onChange={e => setRef(e.target.value || null)}><option value="">資料を選ぶ…</option>{mats.map(m => <option key={m.materialId} value={m.materialId}>{m.fileName}</option>)}</select>;
  const canvas = parts ? <NoteCanvas parts={parts} onChange={setParts} onAdd={addPart} title={item ? `${subject?.subjectName ?? ""}　${item.itemName}` : "ノート"} /> : null;
  const extra = (id: string) => id === item?.itemId ? (<><div className="ind">ノート</div><div className="ind">ストレージ</div>
    {mats.map(m => <div className="ind mat" key={m.materialId} onClick={() => openMat(m.materialId)}>{m.fileName}</div>)}
    <div className="ind click" onClick={() => go({ s: "G011", subjectId: subject.subjectId, itemId: id })}>テスト（{tests.filter(t => t.itemId === id).length}）</div></>) : null;
  return (<div className="app"><Header />
    <Cols>
      <aside className="lf">
        {/* 11/25 夕：「ノートの部品」タブはなくして、部品を置くボタンはノートの上に移した。左の欄は階層だけ */}
        <>
          <Tree heading="科目一覧" extra={extra} />
          {prog !== null && <div className="mute" style={{ margin: "6px 0" }}>文字起こし中… {prog}%</div>}{msg && <div className="err">{msg}</div>}
          {/* 11/17：操作ボタンを「学習項目」「資料」のまとまりに分け、大きく押しやすくした */}
          <div className="sec"><div className="sh">学習項目{item && <b>{item.itemName}</b>}</div>
            <button className="btn pri wide" onClick={addItem}>＋ 学習項目を追加</button>
            <div className="grid2"><button className="btn sm" disabled={!item} onClick={rename}>名前を変更</button><button className="btn sm danger" disabled={!item} onClick={del}>削除</button></div>
            <button className="btn sm wide" disabled={!canLink} onClick={() => setLinking(true)} title="この項目の前に学ぶ項目・次に学ぶ項目を選ぶ（関連図の線になります）">つながりの設定</button></div>
          <div className="sec"><div className="sh">資料</div>
            <label className={"btn wide" + (item ? "" : " disabled")} aria-disabled={!item} style={item ? undefined : { opacity: .45, cursor: "not-allowed" }}>＋ 資料の追加<input hidden type="file" multiple accept="image/*,application/pdf,text/plain,.txt" disabled={!item} onChange={e => { upload(e.target.files); e.target.value = ""; }} /></label>
            <span className="mute">画像・PDF・テキスト（1件20MBまで）。画像とPDFは文字起こしもします</span></div>
        </>
      </aside>
      <main className="ct">{item && parts ? (<>
        {/* 11/24：上のタブ（ノート／資料と並べる・全画面）は、スクロールしても上に残す（.ctop） */}
        <div className="ctop"><Tabs tabs={MODES} value={mode} onChange={setMode}><button className="chip" onClick={() => setFull(true)}>全画面</button><span className="sp" /><b>{item.itemName}</b><span className="mute">　{drafts[item.itemId] ? "未保存の変更あり" : "保存済み"}</span></Tabs></div>
        {/* 11/24：右の資料は .sidepin で包み、スクロールしても付いてくるようにした（長い資料は欄の中でスクロール） */}
        {mode === "side" ? <div className="two"><div>{canvas}</div><div><div className="sidepin">{matSelect}<SideMaterial id={ref} /></div></div></div> : canvas}
        <div className="bar2 stick"><span className="row"><button className="btn pri lg" onClick={doSave} title="保存（Ctrl＋S）">保存</button><button className="btn undo" disabled={!h?.past.length} onClick={() => step(true)} title="元に戻す（Ctrl＋Z）" aria-label="元に戻す">↶</button><button className="btn undo" disabled={!h?.future.length} onClick={() => step(false)} title="やり直す（Ctrl＋Y）" aria-label="やり直す">↷</button></span>
          <span style={{ position: "relative" }}><button className="btn" onClick={() => mats.length === 0 ? toast("資料がまだありません") : mats.length === 1 ? openMat(mats[0].materialId) : setMenu(!menu)}>資料</button>
            {menu && <div className="pop" style={{ position: "absolute", bottom: "110%", left: 0, minWidth: 180, zIndex: 5 }}>{mats.map(m => <div key={m.materialId} className="ind mat" style={{ margin: "3px 0" }} onClick={() => openMat(m.materialId)}>{m.fileName}</div>)}</div>}</span>
          <button className="btn ai" onClick={() => go({ s: "G007", subjectId: subject.subjectId, itemId: item.itemId, purpose: "summary" })}>AIでまとめる</button>
          <button className="btn" onClick={() => go({ s: "G011", subjectId: subject.subjectId, itemId: item.itemId })}>テスト一覧</button>
          <button className="btn" onClick={() => go({ s: "G008", subjectId: subject.subjectId, itemId: item.itemId })}>模擬テスト</button></div>
      </>) : <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ってみよう。</p>}</main>
      <aside className="rt">
        <Tabs tabs={RTABS} value={rtab} onChange={setR} />
        {/* 11/26：関連図の上に「つなぐ」ボタンと、線の色の見方を置いた */}
        {rtab === "graph" ? <>
          <div className="gtop"><span className="mute">先に学ぶ → あとで学ぶ</span><span className="sp" /><button className="btn sm" disabled={!canLink} onClick={() => setLinking(true)} title={canLink ? `「${item!.itemName}」の前・次に学ぶ項目を選ぶ` : "学習項目が2つ以上あるとつなげます"}>＋ つなぐ</button></div>
          <RelationGraph items={its} prerequisites={prerequisites} selId={item?.itemId} onOpen={open} />
          {item && its.length > 1 && <div className="glg"><span><i className="sw b" />前に学ぶ項目から</span><span><i className="sw a" />次に学ぶ項目へ</span></div>}
        </> : (<div className="col">{toc.map(e => <button key={e.partId} className="toc" onClick={() => jump(e.partId)}>{e.label}</button>)}{!toc.length && <p className="mute">見出しと枠がまだありません。</p>}</div>)}
      </aside>
    </Cols>
    {linking && item && <LinkDialog item={item} items={its} prerequisites={prerequisites} onClose={() => setLinking(false)} onSave={saveLinks} />}
    {/* 11/24：全画面でも、右の資料は .sidepin で包んでスクロールしても付いてくるようにした */}
    {full && parts && <div className="fs"><div className="row" style={{ marginBottom: 8 }}><b>{item?.itemName}</b><span className="sp" />{matSelect}<button className="btn pri" onClick={doSave} title="保存（Ctrl＋S）">保存</button><button className="btn line" onClick={() => setFull(false)}>全画面を閉じる</button></div>
      <div className="body" style={{ gridTemplateColumns: ref ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)" }}><div>{canvas}</div>{ref && <div><div className="sidepin"><SideMaterial id={ref} /></div></div>}</div></div>}
  </div>);
}
