// G003 科目一覧画面：左に科目の階層、中央で科目の作成・名前の編集・削除
import { useApp } from "../state/app";
import { uid } from "../lib/logic";
import { Shell } from "./Shell";
import { toast } from "./toast";

export function SubjectList() {
  const { data, setData, route, nav, go, ask, askName } = useApp();
  const cur = data.subjects.find(s => s.id === route.subjectId);
  const add = async () => { const n = await askName("科目の追加"); if (n) { const id = uid(); setData(d => ({ ...d, subjects: [...d.subjects, { id, name: n, items: [] }] })); nav({ s: "G003", subjectId: id }); } };
  const edit = async () => { if (!cur) return; const n = await askName("科目名の編集", cur.name); if (n) setData(d => ({ ...d, subjects: d.subjects.map(s => s.id === cur.id ? { ...s, name: n } : s) })); };
  const del = async () => {
    if (!cur || await ask("科目の中の学習項目・ノート・資料・テストもすべて削除されます", [{ label: "削除する", value: "ok", primary: true }, { label: "やめる", value: "no" }]) !== "ok") return;
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
