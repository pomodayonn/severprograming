// G005 資料表示画面 / G006 文字起こし修正画面
import { useEffect, useState } from "react";
import { useApp } from "../state/app";
import { delBlob, getBlob, putBlob } from "../services/db";
import { Shell } from "./Shell";
import { toast } from "./toast";

export function useBlob(key: string | undefined) {
  const [v, setV] = useState<{ url?: string; text?: string; missing?: boolean } | null>(null);
  useEffect(() => {
    let url = ""; let live = true; setV(null);
    if (!key) { setV({ missing: true }); return; }
    getBlob(key).then(b => { if (!live) return; if (b === undefined) setV({ missing: true }); else if (typeof b === "string") setV({ text: b }); else { url = URL.createObjectURL(b); setV({ url }); } }).catch(() => live && setV({ missing: true }));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [key]);
  return v;
}
export function Viewer({ type, v }: { type: string; v: ReturnType<typeof useBlob> }) {
  if (!v) return <p className="mute">読み込み中…</p>;
  if (v.missing) return <p className="mute">資料はアップロードした端末にだけ保存されます（この端末には入っていません）</p>;
  if (v.text !== undefined) return <pre className="txt">{v.text}</pre>;
  if (type === "pdf") return <iframe title="PDF" src={v.url} className="pdf" />;
  return <img src={v.url} alt="資料" style={{ maxWidth: "100%" }} />;
}
export function MaterialView() {
  const { data, setData, route, go, ask, account } = useApp();
  const m = data.materials.find(x => x.id === route.materialId);
  const v = useBlob(m && account ? `${account.id}:${m.id}` : undefined);
  const back = () => go({ s: "G004", subjectId: route.subjectId, itemId: route.itemId });
  if (!m || !account) return <Shell center={<><p>資料がありません。</p><button className="btn" onClick={back}>戻る</button></>} />;
  const del = async () => {
    const tx = data.materials.filter(x => x.srcId === m.id); let both = false;
    if (tx.length) { const r = await ask(`削除してよいですか。この資料から作られた文字起こし（${tx.map(t => t.name).join("、")}）も一緒に削除しますか`, [{ label: "文字起こしも削除", value: "both", primary: true }, { label: "資料だけ削除", value: "one" }, { label: "やめる", value: "no" }]); if (r === "no") return; both = r === "both"; }
    else if (await ask("この資料を削除してよいですか", [{ label: "削除する", value: "ok", primary: true }, { label: "やめる", value: "no" }]) !== "ok") return;
    const gone = [m.id, ...(both ? tx.map(t => t.id) : [])]; gone.forEach(id => delBlob(`${account.id}:${id}`));
    setData(d => ({ ...d, materials: d.materials.filter(x => !gone.includes(x.id)) })); toast("資料を削除したよ"); back();
  };
  return <Shell center={<>
    <div className="row"><span className="sp" /><span className="fname">{m.name}</span><button className="btn sm line" onClick={del}>削除</button></div>
    <div className="vbox"><Viewer type={m.type} v={v} /></div>
    <div className="bar2">{m.type === "transcript" ? <button className="btn" onClick={() => go({ ...route, s: "G006" })}>修正</button> : <span />}<button className="btn" onClick={back}>戻る</button></div></>} />;
}
export function TranscriptEdit() {
  const { data, route, nav, account } = useApp();
  const m = data.materials.find(x => x.id === route.materialId), src = data.materials.find(x => x.id === m?.srcId);
  const cur = useBlob(m && account ? `${account.id}:${m.id}` : undefined), orig = useBlob(src && account ? `${account.id}:${src.id}` : undefined);
  const [text, setText] = useState<string | null>(null), [ins, setIns] = useState(""), [msg, setMsg] = useState("");
  useEffect(() => { if (cur?.text !== undefined) setText(cur.text); }, [cur]);
  if (!m || !account) return null;
  const back = () => nav({ ...route, s: "G005" });
  const apply = () => { // 修正指示「元→先」で、文字起こしの文字をまとめて置き換える
    const [a, ...b] = ins.split(/→|->/); if (!a.trim() || !b.length) return setMsg("「元の文字→直した文字」の形で入力してください");
    const n = (text ?? "").split(a.trim()).length - 1; if (!n) return setMsg("その文字は見つかりませんでした");
    setText((text ?? "").split(a.trim()).join(b.join("→").trim())); setMsg(`${n}か所を直しました`); setIns("");
  };
  return <Shell center={<>
    <div className="row"><span className="sp" /><span className="fname">{m.name}</span></div>
    <div className="two"><div><h3>元の資料</h3><div className="vbox">{src ? <Viewer type={src.type} v={orig} /> : <p className="mute">元の資料がありません（文字起こしだけ表示しています）</p>}</div></div>
      <div><h3>文字起こし</h3><textarea className="tx" style={{ height: 330 }} value={text ?? ""} onChange={e => setText(e.target.value)} /></div></div></>}
    right={<><div className="row" style={{ justifyContent: "space-between" }}><button className="btn sm" onClick={async () => { await putBlob(`${account.id}:${m.id}`, text ?? ""); toast("上書き保存したよ"); back(); }}>確定</button><button className="btn sm line" onClick={back}>キャンセル</button></div>
      <span className="sp" />{msg && <div className="mute">{msg}</div>}<input className="inp" placeholder="修正指示（例：兀→元）" value={ins} onChange={e => { setIns(e.target.value); setMsg(""); }} onKeyDown={e => e.key === "Enter" && apply()} /></>} />;
}
