// G007 送信内容・提案確認画面：AIに送る内容の編集（送信前）と、AIの提案の確認（返ってきた後）を同じ画面で行う
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/app";
import type { El, FrameType } from "../types";
import { AI_LIMIT, FT, bottomY, calls, chunkText, dayKey, newEl } from "../lib/logic";
import { organize, type Proposal } from "../services/ai";
import { getBlob } from "../services/db";
import { Shell } from "./Shell";
import { toast } from "./toast";

interface Part { id: string; label: string; text: string; kind: "mat" | "frame" }
const frameText = (e: El) => e.ft === "word" ? (e.words ?? []).map(w => `${w.term}：${w.meaning}`).join("\n") : e.text;
const hOf = (n: number) => Math.max(110, 50 + n * 24);
/** 承認された提案をノートに反映：もとからある枠は位置そのままで中身を置き換え、新しい枠は一番下へ。大きくなったら下の枠をずらす */
function apply(els: El[], ps: Proposal[]): El[] {
  let out = [...els];
  for (const p of ps) {
    const nh = p.ft === "word" ? Math.max(150, 90 + (p.words?.length ?? 1) * 30) : hOf(p.text.split("\n").length), t = out.find(e => e.id === p.targetId);
    if (t) { const d = Math.max(0, nh - t.h), bottom = t.y + t.h;
      out = out.map(e => e.id === t.id ? { ...e, text: p.text, words: p.words ?? e.words, h: Math.max(e.h, nh), at: Date.now() } : d && e.y >= bottom ? { ...e, y: e.y + d, at: Date.now() } : e); }
    else { const e = newEl("frame", bottomY(out), p.ft); e.text = p.text; e.h = nh; if (p.ft === "word") e.words = p.words ?? e.words; out.push(e); }
  }
  return out;
}
export function AiSend() {
  const { data, setData, route, nav, go, ask, setDraft, account, setTmp } = useApp();
  const subject = data.subjects.find(s => s.id === route.subjectId), item = subject?.items.find(i => i.id === route.itemId);
  const essay = route.purpose === "essay";
  const [parts, setParts] = useState<Part[]>([]), [sel, setSel] = useState<string[]>([]), [text, setText] = useState("");
  const [types, setTypes] = useState<FrameType[]>(Object.keys(FT) as FrameType[]), [tab, setTab] = useState<"src" | "send" | "prop">("src");
  const [props, setProps] = useState<Proposal[]>([]), [pick, setPick] = useState<string[]>([]), [msg, setMsg] = useState(""), [set, setSet] = useState(false);
  const [ins, setIns] = useState(""), [ref, setRef] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const used = data.usage[dayKey()] ?? 0, frames = useMemo(() => (item?.note.els ?? []).filter(e => e.kind === "frame"), [item]);
  useEffect(() => { // 元にできる内容：文字起こし済みの資料（ページごと）とノートの枠
    if (!item || !account) return; let live = true;
    (async () => {
      const ps: Part[] = [];
      for (const m of data.materials.filter(x => x.itemId === item.id && (x.type === "text" || x.type === "transcript"))) {
        const b = await getBlob(`${account.id}:${m.id}`); if (typeof b === "string") chunkText(b).forEach((c, n) => ps.push({ id: `${m.id}:${n}`, label: `${m.name}　p.${n + 1}`, text: c, kind: "mat" }));
      }
      frames.forEach(e => { const t = frameText(e); if (t.trim()) ps.push({ id: e.id, label: `${FT[e.ft!].n}　${t.slice(0, 16)}`, text: t, kind: "frame" }); });
      if (live) setParts(ps);
    })(); return () => { live = false; };
  }, [item?.id]); // eslint-disable-line
  if (!subject || !item) { setTimeout(() => nav({ s: "G003" }), 0); return null; }
  const back = () => nav({ s: essay ? "G008" : "G004", subjectId: subject.id, itemId: item.id });
  const choose = (ids: string[]) => { setSel(ids); setText(parts.filter(p => ids.includes(p.id)).map(p => p.text).join("\n\n")); setMsg(""); };
  const consume = (n: number) => setData(d => ({ ...d, usage: { ...d.usage, [dayKey()]: (d.usage[dayKey()] ?? 0) + n } }));
  /** 1万文字を超えるときは分けて送る＝利用回数を余分に消費する。確認して、送ってよければ回数を返す */
  const confirmCalls = async (): Promise<number | null> => {
    if (!sel.length || !text.trim()) { setMsg("送る内容を選んでください"); return null; }
    const n = calls(text.length);
    if (used + n > AI_LIMIT) { setMsg(n > 1 ? "残りの利用回数が足りないため、分けて送れません。送る内容を減らしてください" : "今日はこれ以上使えません"); return null; }
    if (n > 1 && await ask(`1万文字を超えているため、分けて送ると利用回数を余分に消費します（この内容では${n}回分）`, [{ label: "このまま送信", value: "ok", primary: true }, { label: "キャンセル", value: "no" }]) !== "ok") return null;
    return n;
  };
  const send = async () => {
    if (!types.length) return setMsg("枠の種類を選んでください");
    const n = await confirmCalls(); if (!n) return; setBusy(true); setMsg("");
    try { const ps = await organize(text, types, frames.map(e => ({ id: e.id, ft: e.ft }))); consume(n); setProps(ps); setPick(ps.map(p => p.id)); setTab("prop"); if (!ps.length) setMsg("提案が作れませんでした。送る内容を見直してください"); }
    catch { setMsg("AIサービスが使えません。時間をおいて試してください"); } setBusy(false);
  };
  const decide = async () => { const n = await confirmCalls(); if (!n) return; setTmp({ send: text, sendCalls: n }); nav({ s: "G008", subjectId: subject.id, itemId: item.id }); };
  const approve = () => {
    const ps = props.filter(p => pick.includes(p.id));
    if (ps.length) setDraft(item.id, { ...item.note, els: apply(item.note.els, ps) }); // 反映するが保存はしない（学習画面の「保存」で保存）
    toast(ps.length ? "提案をノートに反映したよ（保存は学習画面で）" : "提案をすべて捨てたよ"); nav({ s: "G004", subjectId: subject.id, itemId: item.id });
  };
  const replace = () => { // 編集指示「元→先」
    const [a, ...b] = ins.split(/→|->/); if (!a.trim() || !b.length) return setMsg("「元の文字→直した文字」の形で入力してください");
    const to = b.join("→").trim(), f = (s: string) => s.split(a.trim()).join(to);
    if (tab === "prop") setProps(props.map(p => ({ ...p, text: f(p.text), words: p.words?.map(w => ({ term: f(w.term), meaning: f(w.meaning) })) }))); else setText(f(text));
    setIns(""); setMsg("直しました");
  };
  const refText = parts.find(p => p.id === ref)?.text;
  const tabs: [typeof tab, string][] = essay ? [["src", "元にする内容"], ["send", "送る内容"]] : [["src", "元にする内容"], ["send", "送る内容"], ["prop", "提案"]];
  return <Shell center={<>
    <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}<span className="sp" />{essay && <button className="btn" onClick={decide}>決定</button>}</div>
    {tab === "src" && <div className="vbox">{parts.length === 0 && <p className="mute">元にできる内容がありません。資料をアップロードするか、ノートに枠を作ってください。</p>}
      {parts.length > 0 && <div className="row" style={{ marginBottom: 6 }}><button className="btn sm" onClick={() => choose(parts.map(p => p.id))}>すべて選択</button><button className="btn sm line" onClick={() => choose([])}>選択を外す</button></div>}
      {parts.map(p => <label key={p.id} className="ck"><input type="checkbox" checked={sel.includes(p.id)} onChange={e => choose(e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} />{p.label}</label>)}
      <p className="mute">選び直すと、「送る内容」の編集はやり直しになります。</p></div>}
    {tab === "send" && <div className="vbox"><textarea className="tx" value={text} onChange={e => setText(e.target.value)} placeholder="ここに送る内容が入ります。送りたくない文字は削除してください" />
      <div className="mute">{text.length.toLocaleString()}文字（1回あたり1万文字まで）　※個人情報などは送らないでください。送った内容は、どこにも残りません。</div></div>}
    {tab === "prop" && <div className="vbox">{!props.length && <p className="mute">まだ提案がありません。「送る内容」から送信してください。</p>}
      {props.map(p => { const cur = frames.find(e => e.id === p.targetId); return (<div key={p.id} className="box" style={{ marginTop: 0, marginBottom: 8 }}>
        <label className="ck"><input type="checkbox" checked={pick.includes(p.id)} onChange={e => setPick(e.target.checked ? [...pick, p.id] : pick.filter(x => x !== p.id))} /><b>{FT[p.ft].n}</b>　{cur ? "（もとの枠の書き換え）" : "（新しい枠）"}</label>
        <div className={cur ? "two" : ""}>{cur && <div><div className="mute">いまの中身</div><pre className="txt">{frameText(cur)}</pre></div>}
          <div>{cur && <div className="mute">提案</div>}<textarea className="tx" style={{ minHeight: 90 }} value={p.ft === "word" ? (p.words ?? []).map(w => `${w.term}：${w.meaning}`).join("\n") : p.text}
            onChange={e => setProps(props.map(x => x.id !== p.id ? x : p.ft === "word" ? { ...x, words: e.target.value.split("\n").filter(Boolean).map(l => { const [a, ...b] = l.split(/：|:/); return { term: a.trim(), meaning: b.join("：").trim() }; }) } : { ...x, text: e.target.value }))} /></div></div></div>); })}</div>}
    {set && !essay && <div className="pop"><h3>設定　振り分ける枠の種類</h3>{(Object.keys(FT) as FrameType[]).map(k => <label key={k} className="ck"><input type="checkbox" checked={types.includes(k)} onChange={e => setTypes(e.target.checked ? [...types, k] : types.filter(x => x !== k))} />{FT[k].n}</label>)}</div>}
    {set && essay && <div className="pop">記述テストに使う内容を決めます。AIの利用はテストを作るときです。</div>}
    <div className="mute" style={{ marginTop: 8 }}>今日の残り利用回数：{AI_LIMIT} 回中 {Math.max(0, AI_LIMIT - used)} 回</div>{msg && <div className="err">{msg}</div>}
    <div className="bar2 stick"><span className="row">{!essay && <button className="btn" disabled={busy || tab === "prop"} onClick={send}>{busy ? "送信中…" : "送信"}</button>}<button className="btn line" onClick={() => setSet(!set)}>設定</button>
      {!essay && <button className="btn" disabled={tab !== "prop"} onClick={approve}>承認</button>}</span>
      <button className="btn line" onClick={async () => { if (tab === "prop" && props.length) { toast("提案をすべて捨てたよ"); } await go({ s: essay ? "G008" : "G004", subjectId: subject.id, itemId: item.id }); }}>キャンセル</button></div></>}
    right={<><h3>参照</h3><div className="mute">ストレージの資料とノートの枠。押すと中身を見られます（AIの提案と見比べるとき）</div>
      <div className="col" style={{ gap: 2 }}>{parts.map(p => <button key={p.id} className="toc" onClick={() => setRef(p.id === ref ? null : p.id)}>{p.label}</button>)}</div>
      {refText && <pre className="txt" style={{ fontSize: 12, borderTop: "1px solid #cdbfe0", paddingTop: 6 }}>{refText}</pre>}
      <span className="sp" />{msg && <div className="mute">{msg}</div>}<input className="inp" placeholder="編集指示（例：兀→元）" value={ins} onChange={e => setIns(e.target.value)} onKeyDown={e => e.key === "Enter" && replace()} /></>} />;
}
