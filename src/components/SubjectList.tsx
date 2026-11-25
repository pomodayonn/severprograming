// G003 科目一覧画面：左に科目の階層、中央で科目の作成・名前の編集・削除
// 11/11：作成・名前の編集・削除を Controller → SubjectManager 経由にした（A）。
// 11/21：成功したら reload() で Manager から読み直す（前は data.subjects を手で同じように書き換えていた）
// 11/25：科目を消しやすくした。中央に科目の一覧（中身の数つき）を出し、行ごとの「削除」と、チェックしてまとめて削除ができる。
//        確認の窓には、消える科目の名前と、中の学習項目・テスト・資料の数を出す
//
// 【このファイルで何が起きているか】
// 科目一覧画面（G003）です。科目の追加・名前の編集・削除と、科目を開くボタンがある。
// ボタンを押したときの流れ：画面 → controller.handleRequest("G003", イベントID) → Manager → DAO → 端末に保存（→ Neon）
// 結果に error があれば画面に文を出し、なければ reload() で科目を読み直す
import { useApp } from "../state/app";
import { controller } from "../controller/Controller";
import type { Subject } from "../beans/Subject";
import { useState } from "react";
import { countsOf, itemsOf } from "../lib/select";
import { Shell } from "./Shell";
import { toast } from "./toast";

export function SubjectList() {
  const { account, subjects, items, tests, materials, loaded, reload, route, nav, go, ask, askName } = useApp();
  const [checked, setChecked] = useState<string[]>([]), [busy, setBusy] = useState(false);
  const cur = subjects.find(s => s.subjectId === route.subjectId), curItems = itemsOf(items, cur?.subjectId);
  const sid = account?.studentId ?? "";

  const add = async () => {
    const n = await askName("科目の追加"); if (!n) return;
    const r = await controller.handleRequest("G003", "addSubject", { studentId: sid, name: n });
    if (r.error) return toast(r.error);
    const s = r.data as Subject;
    await reload();
    nav({ s: "G003", subjectId: s.subjectId });
  };
  const edit = async () => {
    if (!cur) return;
    const n = await askName("科目名の編集", cur.subjectName); if (!n) return;
    const r = await controller.handleRequest("G003", "renameSubject", { studentId: sid, subjectId: cur.subjectId, name: n });
    if (r.error) return toast(r.error);
    await reload();
  };
  /** 科目を消す。ids が1つなら「理科」、2つ以上なら「選んだ 3 件の科目」と聞く */
  const del = async (ids: string[]) => {
    const targets = subjects.filter(s => ids.includes(s.subjectId)); if (!targets.length || busy) return;
    const c = targets.map(s => countsOf(s.subjectId, items, tests, materials)).reduce((a, b) => ({ items: a.items + b.items, tests: a.tests + b.tests, materials: a.materials + b.materials }));
    const what = targets.length === 1 ? `「${targets[0].subjectName}」` : `選んだ ${targets.length} 件の科目（${targets.map(s => s.subjectName).join("・")}）`;
    const inside = c.items ? `中の学習項目 ${c.items} 件・テスト ${c.tests} 件・資料 ${c.materials} 件と、ノートもすべて消えて、戻せません。` : "中に学習項目はありません。";
    if (await ask(`${what}を削除してよいですか。${inside}`, [{ label: "削除する", value: "ok", danger: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    setBusy(true);
    let done = 0;
    for (const s of targets) {
      const r = await controller.handleRequest("G003", "deleteSubject", { subjectId: s.subjectId });
      if (r.error) { toast(`「${s.subjectName}」を削除できませんでした：${r.error}`); break; }
      done++;
    }
    setBusy(false); setChecked([]);
    await reload(); // 資料（ストレージ）も SubjectManager → LearningItemManager.deleteItem が一緒に消す
    if (cur && ids.includes(cur.subjectId)) nav({ s: "G003" });
    if (done) toast(done === 1 ? "科目を削除したよ" : `${done} 件の科目を削除したよ`);
  };
  const toggle = (id: string) => setChecked(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  const allOn = subjects.length > 0 && subjects.every(s => checked.includes(s.subjectId));
  return <Shell heading="科目を選択" right={<div />} center={<div className="panel">
    <div className="row"><h2>科目</h2><span className="sp" /><button className="btn pri" onClick={add}>＋ 科目の追加</button></div>
    {!loaded && <p className="mute loading">読み込み中…</p>}{/* 11/22：ログインした直後、端末のデータを読み終わるまで */}
    {loaded && !subjects.length && <p className="mute">科目がまだありません。「科目の追加」から作ってみよう。</p>}
    {subjects.length > 0 && !cur && <p className="mute">左の一覧か、下の「科目の一覧」から科目を選んでください。</p>}
    {cur && <div className="box"><h3>{cur.subjectName}</h3><p className="mute">学習項目 {curItems.length} 件</p>
      <div className="row"><button className="btn pri lg" onClick={() => go({ s: "G004", subjectId: cur.subjectId, itemId: curItems[0]?.itemId })}>この科目を開く</button><button className="btn" onClick={edit}>名前の編集</button><button className="btn danger" disabled={busy} onClick={() => del([cur.subjectId])}>削除</button></div></div>}
    {subjects.length > 0 && <div className="box slist">
      <div className="row"><h4>科目の一覧</h4><span className="sp" />
        <label className="chk"><input type="checkbox" checked={allOn} onChange={() => setChecked(allOn ? [] : subjects.map(s => s.subjectId))} />すべて選ぶ</label>
        <button className="btn danger" disabled={!checked.length || busy} onClick={() => del(checked)}>{busy ? "削除中…" : `選んだ科目を削除${checked.length ? `（${checked.length} 件）` : ""}`}</button></div>
      {subjects.map(s => { const c = countsOf(s.subjectId, items, tests, materials); return (
        <div key={s.subjectId} className={"srow" + (s.subjectId === cur?.subjectId ? " on" : "")}>
          <input type="checkbox" checked={checked.includes(s.subjectId)} onChange={() => toggle(s.subjectId)} aria-label={`${s.subjectName} を選ぶ`} />
          <button className="link sname" onClick={() => nav({ s: "G003", subjectId: s.subjectId })}>{s.subjectName}</button>
          <small className="mute">学習項目 {c.items}・テスト {c.tests}・資料 {c.materials}</small><span className="sp" />
          <button className="btn sm danger" disabled={busy} onClick={() => del([s.subjectId])} aria-label={`${s.subjectName} を削除`}>削除</button>
        </div>); })}
    </div>}
  </div>} />;
}