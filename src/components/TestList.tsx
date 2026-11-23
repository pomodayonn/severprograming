// G011 テスト一覧：その科目のテストの一覧。「結果表示」「解き直し」
// 11/23：Tests.tsx から分けた（中身は変えていない）
//
// 【共通の流れ】
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useState } from "react";
import { useApp } from "../state/app";
import { fmt, ymd } from "../lib/logic";
import { itemsOf, lastScore } from "../lib/select";
import type { Test } from "../beans/Test";
import { Shell } from "./Shell";
import { KIND } from "./testCommon";

export function TestList() {
  const { subjects, items, tests, route, nav } = useApp();
  const [sid, setSid] = useState(route.subjectId ?? subjects[0]?.subjectId), [sel, setSel] = useState<string | null>(null);
  const rows = itemsOf(items, sid).flatMap(i => tests.filter(t => t.itemId === i.itemId).map(t => ({ t, i }))).sort((a, b) => b.t.createdAt.localeCompare(a.t.createdAt));
  const base = (t?: Test) => ({ subjectId: sid, itemId: t?.itemId ?? route.itemId });
  const selected = rows.find(r => r.t.testId === sel)?.t;
  return <Shell center={<>
    <div className="folders">{subjects.map(s => <div key={s.subjectId} className={"folder" + (s.subjectId === sid ? " on" : "")} onClick={() => { setSid(s.subjectId); setSel(null); }}><i />{s.subjectName}</div>)}</div>
    <div className="vbox" style={{ minHeight: 220 }}>{rows.length === 0 && <p className="mute">テストがまだありません。</p>}
      {rows.map(({ t, i }) => <div key={t.testId} className={"trow" + (sel === t.testId ? " on" : "")} onClick={() => setSel(t.testId)}><i className="dot" /><span>{i.itemName}-{ymd(t.createdAt)}</span><span className="mute">{KIND[t.testType]}／{t.questions.length}問／最後に解いた日時 {fmt(t.lastTakenAt)}</span>{(() => { const sc = lastScore(t); return sc && <span className={"tscore" + (sc.ok === sc.total ? " full" : "")} title={`第${sc.attemptNo}回の結果`}>前回 {sc.ok}/{sc.total}</span>; })()}</div>)}</div>
    <div className="bar2"><span className="row"><button className="btn pri" disabled={!sel} onClick={() => nav({ s: "G010", ...base(selected), testId: sel!, mode: "list" })}>結果表示</button>
      <button className="btn" disabled={!sel} onClick={() => nav({ s: "G009", ...base(selected), testId: sel!, mode: "retry" })}>解き直し</button></span>
      <button className="btn line" onClick={() => nav({ s: "G004", subjectId: route.subjectId ?? sid, itemId: route.itemId })}>戻る</button></div></>} />;
}
