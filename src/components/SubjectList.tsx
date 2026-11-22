// G003 科目一覧画面：左に科目の階層、中央で科目の作成・名前の編集・削除
// 11/11：作成・名前の編集・削除を Controller → SubjectManager 経由にした（A）。
// 11/21：成功したら reload() で Manager から読み直す（前は data.subjects を手で同じように書き換えていた）
//
// 【このファイルで何が起きているか】
// 科目一覧画面（G003）です。科目の追加・名前の編集・削除と、科目を開くボタンがある。
// ボタンを押したときの流れ：画面 → controller.handleRequest("G003", イベントID) → Manager → DAO → 端末に保存（→ Neon）
// 結果に error があれば画面に文を出し、なければ reload() で科目を読み直す
import { useApp } from "../state/app";
import { controller } from "../controller/Controller";
import type { Subject } from "../beans/Subject";
import { itemsOf } from "../lib/select";
import { Shell } from "./Shell";
import { toast } from "./toast";

export function SubjectList() {
  const { account, subjects, items, loaded, reload, route, nav, go, ask, askName } = useApp();
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
  const del = async () => {
    if (!cur || await ask("科目の中の学習項目・ノート・資料・テストもすべて削除されます", [{ label: "削除する", value: "ok", danger: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    const r = await controller.handleRequest("G003", "deleteSubject", { subjectId: cur.subjectId });
    if (r.error) return toast(r.error);
    await reload(); // 資料（ストレージ）も SubjectManager → LearningItemManager.deleteItem が一緒に消す
    nav({ s: "G003" }); toast("科目を削除したよ");
  };
  return <Shell heading="科目を選択" right={<div />} center={<div className="panel">
    <div className="row"><h2>科目</h2><span className="sp" /><button className="btn pri" onClick={add}>＋ 科目の追加</button></div>
    {!loaded && <p className="mute loading">読み込み中…</p>}{/* 11/22：ログインした直後、端末のデータを読み終わるまで */}
    {loaded && !subjects.length && <p className="mute">科目がまだありません。「科目の追加」から作ってみよう。</p>}
    {subjects.length > 0 && !cur && <p className="mute">左の一覧から科目を選んでください。</p>}
    {cur && <div className="box"><h3>{cur.subjectName}</h3><p className="mute">学習項目 {curItems.length} 件</p>
      <div className="row"><button className="btn pri lg" onClick={() => go({ s: "G004", subjectId: cur.subjectId, itemId: curItems[0]?.itemId })}>この科目を開く</button><button className="btn" onClick={edit}>名前の編集</button><button className="btn danger" onClick={del}>削除</button></div></div>}
  </div>} />;
}