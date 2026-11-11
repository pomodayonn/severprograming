// G003 科目一覧画面：左に科目の階層、中央で科目の作成・名前の編集・削除
// 11/11：作成・名前の編集・削除を Controller → SubjectManager 経由にした（A）。
// ほかの画面がまだ data.subjects を使っているので、Manager で成功したら data.subjects にも同じ変更を入れる（移行中のつなぎ）
import { useEffect } from "react";
import { useApp } from "../state/app";
import { controller } from "../controller/Controller";
import type { Subject as SubjectBean } from "../beans/Subject";
import { Shell } from "./Shell";
import { toast } from "./toast";

export function SubjectList() {
  const { account, data, setData, route, nav, go, ask, askName } = useApp();
  const cur = data.subjects.find(s => s.id === route.subjectId);
  const sid = account?.id ?? "";

  // 移行用：前からある科目を、Manager の保存場所にも入れておく（同じIDなので2回目からは何もしない）
  useEffect(() => {
    if (sid && data.subjects.length) void controller.subjectManager.importSubjects(sid, data.subjects.map(s => ({ id: s.id, name: s.name })));
  }, [sid, data.subjects]);

  const add = async () => {
    const n = await askName("科目の追加"); if (!n) return;
    const r = await controller.handleRequest("G003", "addSubject", { studentId: sid, name: n });
    if (r.error) return toast(r.error);
    const s = r.data as SubjectBean;
    setData(d => ({ ...d, subjects: [...d.subjects, { id: s.subjectId, name: s.subjectName, items: [] }] }));
    nav({ s: "G003", subjectId: s.subjectId });
  };
  const edit = async () => {
    if (!cur) return;
    const n = await askName("科目名の編集", cur.name); if (!n) return;
    const r = await controller.handleRequest("G003", "renameSubject", { studentId: sid, subjectId: cur.id, name: n });
    if (r.error) return toast(r.error);
    setData(d => ({ ...d, subjects: d.subjects.map(s => s.id === cur.id ? { ...s, name: n.trim() } : s) }));
  };
  const del = async () => {
    if (!cur || await ask("科目の中の学習項目・ノート・資料・テストもすべて削除されます", [{ label: "削除する", value: "ok", primary: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    const r = await controller.handleRequest("G003", "deleteSubject", { subjectId: cur.id });
    if (r.error) return toast(r.error);
    setData(d => { const ids = cur.items.map(i => i.id); return { ...d, subjects: d.subjects.filter(s => s.id !== cur.id), materials: d.materials.filter(m => !ids.includes(m.itemId)), tests: d.tests.filter(t => !ids.includes(t.itemId)) }; });
    nav({ s: "G003" }); toast("科目を削除したよ");
  };
  return <Shell heading="科目を選択" right={<div />} center={<div className="panel">
    <div className="row"><h2>科目</h2><span className="sp" /><button className="btn dark" onClick={add}>＋ 科目の追加</button></div>
    {!data.subjects.length && <p className="mute">科目がまだありません。「科目の追加」から作ってみよう。</p>}
    {data.subjects.length > 0 && !cur && <p className="mute">左の一覧から科目を選んでください。</p>}
    {cur && <div className="box"><h3>{cur.name}</h3><p className="mute">学習項目 {cur.items.length} 件</p>
      <div className="row"><button className="btn dark" onClick={() => go({ s: "G004", subjectId: cur.id, itemId: cur.items[0]?.id })}>この科目を開く</button><button className="btn line" onClick={edit}>名前の編集</button><button className="btn line" onClick={del}>削除</button></div></div>}
  </div>} />;
}