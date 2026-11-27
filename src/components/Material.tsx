// G005 資料表示画面 / G006 文字起こし修正画面
// 11/21（福山）：資料の中身の読み書き・削除を Controller → MaterialManager 経由にした（前は services/db.ts を直接さわっていた）
// 【このファイルで何が起きているか】
// 資料表示画面（G005）と、文字起こし修正画面（G006）です。
// ・useMaterialContent：資料の中身を Controller（getContent）から受け取り、画像・PDF なら表示用の URL を作る
// ・Viewer ：中身の種類（文字・PDF・画像）に合わせて表示する
// ・G005 の「削除」→ Controller（G005:deleteMaterial）→ MaterialManager.delete
// ・G006 では「元の文字→直した文字」の形の指示で、文字起こしの文字をまとめて置き換えられる。「確定」→ Controller（G006:correctTranscript）
// 11/21 道B：資料は beans の Material のまま使う（materialId・fileName・fileType・sourceMaterialId）
// 11/24：G005 にも「資料と並べる」タブ。同じ学習項目のほかの資料を選んで、右に並べて見られる
import { useEffect, useState } from "react";
import { useApp } from "../state/app";
import { controller } from "../controller/Controller";
import { parseReplace, replaceText } from "../lib/logic";
import { Shell } from "./Shell";
import { Tabs } from "./Tabs";
import { toast } from "./toast";

/** 資料の中身を読む（screen は呼んでいる画面のID。Controller の「画面ID:getContent」に使う） */
export function useMaterialContent(screen: "G004" | "G005" | "G006" | "G007", materialId: string | undefined) {
  const [v, setV] = useState<{ url?: string; text?: string; missing?: boolean } | null>(null);
  useEffect(() => {
    let url = ""; let live = true; setV(null);
    if (!materialId) { setV({ missing: true }); return; }
    controller.handleRequest(screen, "getContent", { materialId }).then(r => {
      if (!live) return;
      const b = r.data as Blob | string | null | undefined;
      if (r.error || b == null) setV({ missing: true });
      else if (typeof b === "string") setV({ text: b });
      else { url = URL.createObjectURL(b); setV({ url }); }
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [screen, materialId]);
  return v;
}
export function Viewer({ type, v }: { type: string; v: ReturnType<typeof useMaterialContent> }) {
  if (!v) return <p className="mute">読み込み中…</p>;
  if (v.missing) return <p className="mute">資料は追加した端末にのみ保存されます。この端末では表示できません。</p>;
  if (v.text !== undefined) return <pre className="txt">{v.text}</pre>;
  if (type === "pdf") return <iframe title="PDF" src={v.url} className="pdf" />;
  return <img src={v.url} alt="資料" style={{ maxWidth: "100%" }} />;
}
/** G005 のタブ（値と、画面に出す名前）。学習画面の「ノート／資料と並べる」と同じ形 */
const VMODES = [["one", "この資料"], ["side", "資料と並べる"]] as const;
/** 「資料と並べる」の右側：選んだ資料を表示する */
function SideView({ id }: { id: string | null }) {
  const { materials } = useApp(); const s = materials.find(x => x.materialId === id); const v = useMaterialContent("G005", s?.materialId);
  return <div className="vbox">{s ? <Viewer type={s.fileType} v={v} /> : <p className="mute">表示する資料を選択してください。</p>}</div>;
}
export function MaterialView() {
  const { materials, reload, route, go, ask, account } = useApp();
  const m = materials.find(x => x.materialId === route.materialId);
  const v = useMaterialContent("G005", m?.materialId);
  const [mode, setMode] = useState<"one" | "side">("one"), [sideId, setSideId] = useState<string | null>(null);
  const back = () => go({ s: "G004", subjectId: route.subjectId, itemId: route.itemId });
  if (!m || !account) return <Shell center={<><p>資料がありません。</p><button className="btn" onClick={back}>戻る</button></>} />;
  const del = async () => {
    const tx = materials.filter(x => x.sourceMaterialId === m.materialId); let both = false;
    if (tx.length) { const r = await ask(`削除してよいですか。この資料から作られた文字起こし（${tx.map(t => t.fileName).join("、")}）も一緒に削除しますか`, [{ label: "文字起こしも削除", value: "both", danger: true }, { label: "資料だけ削除", value: "one" }, { label: "キャンセル", value: "no" }]); if (r === "no") return; both = r === "both"; }
    else if (await ask("この資料を削除しますか？ 元に戻せません。", [{ label: "削除する", value: "ok", danger: true }, { label: "キャンセル", value: "no" }]) !== "ok") return;
    const r = await controller.handleRequest("G005", "deleteMaterial", { materialId: m.materialId, withTranscript: both });
    if (r.error) return toast(r.error);
    await reload(); toast("資料を削除しました"); back();
  };
  const others = materials.filter(x => x.itemId === m.itemId && x.materialId !== m.materialId); // 並べられる資料（同じ学習項目のほかの資料）
  const side = others.some(x => x.materialId === sideId) ? sideId : null; // 選んでいた資料が消されたら、選んでいないことにする
  const main = <div className="vbox"><Viewer type={m.fileType} v={v} /></div>;
  return <Shell center={<>
    {/* 11/24：上のタブはスクロールしても上に残す（.ctop。学習画面と同じ） */}
    <div className="ctop"><Tabs tabs={VMODES} value={mode} onChange={setMode}><span className="sp" /><span className="fname">{m.fileName}</span></Tabs></div>
    {/* 11/24：右の資料は .sidepin で包み、スクロールしても付いてくるようにした（長い資料は欄の中でスクロール） */}
    {mode === "side" ? <div className="two">{main}
      <div><div className="sidepin">{others.length ? <select className="inp" value={side ?? ""} onChange={e => setSideId(e.target.value || null)}><option value="">並べる資料を選ぶ…</option>{others.map(x => <option key={x.materialId} value={x.materialId}>{x.fileName}</option>)}</select>
        : <p className="mute">この学習項目には、ほかの資料がありません。</p>}<SideView id={side} /></div></div></div> : main}
    {/* 11/24：「修正」「削除」「戻る」はスクロールしても下に残す（.stick）。「削除」は「修正」の右隣 */}
    <div className="bar2 stick"><span className="row">{m.fileType === "transcript" && <button className="btn pri" onClick={() => go({ ...route, s: "G006" })}>修正</button>}<button className="btn danger" onClick={del}>削除</button></span>
      <span className="sp" /><button className="btn" onClick={back}>戻る</button></div></>} />;
}
export function TranscriptEdit() {
  const { materials, route, nav, account } = useApp();
  const m = materials.find(x => x.materialId === route.materialId), src = materials.find(x => x.materialId === m?.sourceMaterialId);
  const cur = useMaterialContent("G006", m?.materialId), orig = useMaterialContent("G006", src?.materialId);
  const [text, setText] = useState<string | null>(null), [ins, setIns] = useState(""), [msg, setMsg] = useState("");
  useEffect(() => { if (cur?.text !== undefined) setText(cur.text); }, [cur]);
  if (!m || !account) return null;
  const back = () => nav({ ...route, s: "G005" });
  const apply = () => { // 修正指示「元→先」で、文字起こしの文字をまとめて置き換える
    const r = parseReplace(ins); if (!r) return setMsg("「置換前→置換後」の形式で入力してください");
    const n = (text ?? "").split(r.from).length - 1; if (!n) return setMsg("その文字は見つかりませんでした");
    setText(replaceText(text ?? "", r)); setMsg(`${n}か所を置換しました`); setIns("");
  };
  // 11/24：「元の資料」「文字起こし」の欄は、画面の下まで使って表示する（cls="tedit"。index.css の .tedit）
  return <Shell cls="tedit" center={<>
    <div className="row"><span className="sp" /><span className="fname">{m.fileName}</span></div>
    <div className="two"><div><h3>元の資料</h3><div className="vbox">{src ? <Viewer type={src.fileType} v={orig} /> : <p className="mute">元の資料がありません（文字起こしだけ表示しています）</p>}</div></div>
      <div><h3>文字起こし</h3><textarea className="tx" value={text ?? ""} onChange={e => setText(e.target.value)} /></div></div></>}
    right={<><div className="row" style={{ justifyContent: "space-between" }}><button className="btn pri" onClick={async () => {
      const r = await controller.handleRequest("G006", "correctTranscript", { materialId: m.materialId, text: text ?? "" });
      if (r.error) return toast(r.error);
      toast("保存しました"); back();
    }}>保存</button><button className="btn line" onClick={back}>キャンセル</button></div>
      <span className="sp" />{msg && <div className="mute">{msg}</div>}<input className="inp" placeholder="文字を一括置換（例：兀→元）" value={ins} onChange={e => { setIns(e.target.value); setMsg(""); }} onKeyDown={e => e.key === "Enter" && apply()} /></>} />;
}
