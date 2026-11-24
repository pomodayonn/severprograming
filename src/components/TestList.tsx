// G011 テスト一覧：その科目のテストの一覧。「結果表示」「解き直し」
// 11/23：並べかえ（作った日・最近解いた・点数が低い・名前）と、削除（左のチェックでまとめて消せる）を足した
// 11/23：Tests.tsx から分けた（中身は変えていない）
// 11/25：上（科目・すべて選ぶ・並べかえ）と下（結果表示・解き直し・削除・戻る）は、スクロールしても画面に残す
//
// 【共通の流れ】
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useState } from "react";
import { useApp } from "../state/app";
import { fmt, ymd } from "../lib/logic";
import { itemsOf, lastScore, sortTests, TEST_SORTS, type TestSort } from "../lib/select";
import { controller } from "../controller/Controller";
import type { Test } from "../beans/Test";
import { Shell } from "./Shell";
import { toast } from "./toast";
import { KIND } from "./testCommon";

/** 並べ方は、次に開いたときも同じにする（この端末だけ。保存できないブラウザでは毎回「新しい順」） */
const SORT_KEY = "runndesu:testSort";
const loadSort = (): TestSort => { try { const v = localStorage.getItem(SORT_KEY); return TEST_SORTS.some(([k]) => k === v) ? v as TestSort : "new"; } catch { return "new"; } };
const saveSort = (v: TestSort) => { try { localStorage.setItem(SORT_KEY, v); } catch { /* 保存できなくても並べかえはできる */ } };

export function TestList() {
  const { subjects, items, tests, route, nav, ask, reload } = useApp();
  const [sid, setSid] = useState(route.subjectId ?? subjects[0]?.subjectId), [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<TestSort>(loadSort), [checked, setChecked] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const rows = sortTests(itemsOf(items, sid).flatMap(i => tests.filter(t => t.itemId === i.itemId).map(t => ({ t, i }))), sort);
  const base = (t?: Test) => ({ subjectId: sid, itemId: t?.itemId ?? route.itemId });
  const selected = rows.find(r => r.t.testId === sel)?.t;
  // 削除するもの：チェックがあればチェックしたテスト、なければ選んでいるテスト
  const targets = checked.length ? checked : sel ? [sel] : [];
  const toggle = (id: string) => setChecked(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  const allOn = rows.length > 0 && rows.every(r => checked.includes(r.t.testId));
  const changeSubject = (id: string) => { setSid(id); setSel(null); setChecked([]); };
  const del = async () => {
    if (!targets.length) return;
    const one = targets.length === 1 ? rows.find(r => r.t.testId === targets[0]) : undefined;
    const what = one ? `「${one.i.itemName}-${ymd(one.t.createdAt)}」` : `選んだ ${targets.length} 件のテスト`;
    if (await ask(`${what}を削除してよいですか。解いた結果や解説も消えて、戻せません`, [{ label: "削除する", value: "ok", danger: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    setBusy(true);
    const r = await controller.handleRequest("G011", "deleteTest", { testIds: targets });
    setBusy(false);
    if (r.error) return toast(r.error);
    setChecked([]); if (sel && targets.includes(sel)) setSel(null);
    await reload(); toast(targets.length === 1 ? "テストを削除したよ" : `${targets.length} 件のテストを削除したよ`);
  };
  return <Shell center={<>
    <div className="ltop"><div className="folders">{subjects.map(s => <div key={s.subjectId} className={"folder" + (s.subjectId === sid ? " on" : "")} onClick={() => changeSubject(s.subjectId)}><i />{s.subjectName}</div>)}</div>
    {rows.length > 0 && <div className="row tlhead">
      <label className="chk"><input type="checkbox" checked={allOn} onChange={() => setChecked(allOn ? [] : rows.map(r => r.t.testId))} />すべて選ぶ</label>
      <span className="mute">{rows.length} 件</span><span className="sp" />
      <label className="mute" htmlFor="tsort">並べかえ</label>
      <select id="tsort" className="inp sel" value={sort} onChange={e => { const v = e.target.value as TestSort; setSort(v); saveSort(v); }}>{TEST_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>}</div>
    <div className="vbox" style={{ minHeight: 220 }}>{rows.length === 0 && <p className="mute">テストがまだありません。</p>}
      {rows.map(({ t, i }) => <div key={t.testId} className={"trow" + (sel === t.testId ? " on" : "")} onClick={() => setSel(t.testId)}>
        <input type="checkbox" checked={checked.includes(t.testId)} onClick={e => e.stopPropagation()} onChange={() => toggle(t.testId)} aria-label={`${i.itemName}-${ymd(t.createdAt)} を選ぶ`} />
        <div className="tname"><span>{i.itemName}-{ymd(t.createdAt)}</span>{(() => { const info = `${KIND[t.testType]}・${t.questions.length}問・作成 ${fmt(t.createdAt)}・最後に解いた ${fmt(t.lastTakenAt)}`; return <small className="mute" title={info}>{info}</small>; })()}</div>{(() => { const sc = lastScore(t); return sc && <span className={"tscore" + (sc.ok === sc.total ? " full" : "")} title={`第${sc.attemptNo}回の結果`}>前回 {sc.ok}/{sc.total}</span>; })()}</div>)}</div>
    <div className="bar2 stick"><span className="row"><button className="btn pri" disabled={!sel} onClick={() => nav({ s: "G010", ...base(selected), testId: sel!, mode: "list" })}>結果表示</button>
      <button className="btn" disabled={!sel} onClick={() => nav({ s: "G009", ...base(selected), testId: sel!, mode: "retry" })}>解き直し</button>
      <button className="btn danger" disabled={!targets.length || busy} onClick={del}>{busy ? "削除中…" : checked.length > 1 ? `削除（${checked.length} 件）` : "削除"}</button></span>
      <span className="sp" /><button className="btn line" onClick={() => nav({ s: "G004", subjectId: route.subjectId ?? sid, itemId: route.itemId })}>戻る</button></div></>} />;
}
