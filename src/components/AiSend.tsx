// G007 送信内容・提案確認画面：AIに送る内容の編集（送信前）と、AIの提案の確認（返ってきた後）を同じ画面で行う
//
// 【このファイルで何が起きているか】
// 送信内容・提案確認画面（G007）です。使い方が2つある。
// ・AIまとめ（purpose = "summary"）：
//     1. 元にする内容（文字起こし・ノートの枠）を選ぶ → 2. 送る内容を編集 → 3. 送信 → 4. AIの提案を確認して承認
//     承認した提案は apply() でノートの下書きに入れる（保存は学習画面で「保存」を押したとき）
// ・記述テスト（purpose = "essay"）：送る内容を決めて、テスト作成画面（G008）に戻る
// 1万文字を超えると分けて送ることになり、その分AIの利用回数を多く使う（confirmCalls で確認する）
// 送信（G007:summarize）と承認（G007:approve）は Controller → AiSummaryManager を通る
// 11/21 道B：AIの提案は beans の Suggestion のまま扱う（単語枠の提案は content に「用語：意味」の行で入っている）。
//   ノートは NotePart のまま送り、承認したら NotePart のリストが返ってくるので、それを下書きにする
import { useEffect, useMemo, useState } from "react";
import { Redirect, useApp } from "../state/app";
import type { FrameType } from "../types";
import { FT, calls, chunkText, parseReplace, replaceText } from "../lib/logic";
import { itemsOf, partsOf } from "../lib/select";
import { addLocalUsage, useAiRemaining } from "../services/ai";
import { controller } from "../controller/Controller";
import { wordsToText } from "../lib/words";
import type { NotePart } from "../beans/NotePart";
import { Suggestion } from "../beans/Suggestion";
import { PartType } from "../enums/PartType";
import { AiWait, useOnline } from "./AiWait";
import { Shell } from "./Shell";
import { toast } from "./toast";

interface Part { id: string; label: string; text: string; kind: "mat" | "frame" }
/** 枠の中身を文字にする（単語枠は「用語：意味」の行） */
const frameText = (p: NotePart) => p.frameType === "word" ? wordsToText(p.words) : p.text;
const frameName = (p: { frameType: string | null }) => FT[p.frameType as FrameType]?.n ?? "枠";
export function AiSend() {
  const { materials, subjects, items, notes, route, nav, go, ask, setDraft, account, setTmp, drafts } = useApp();
  const online = useOnline();
  const subject = subjects.find(s => s.subjectId === route.subjectId), item = itemsOf(items, route.subjectId).find(i => i.itemId === route.itemId);
  const essay = route.purpose === "essay";
  const [parts, setParts] = useState<Part[]>([]), [sel, setSel] = useState<string[]>([]), [text, setText] = useState("");
  const [types, setTypes] = useState<FrameType[]>(Object.keys(FT) as FrameType[]), [tab, setTab] = useState<"src" | "send" | "prop">("src");
  // 提案（Suggestion）と、使うことにした提案の番号
  const [props, setProps] = useState<Suggestion[]>([]), [pick, setPick] = useState<number[]>([]), [msg, setMsg] = useState(""), [set, setSet] = useState(false);
  const [ins, setIns] = useState(""), [ref, setRef] = useState<string | null>(null), [busy, setBusy] = useState(false);
  // 今のノートの部品：下書き（まだ保存していない変更）があれば下書き、なければ保存してあるノート
  const noteParts = item ? (drafts[item.itemId] ?? partsOf(notes, item.itemId)) : null;
  const { remaining, limit, refresh } = useAiRemaining(), frames = useMemo(() => (noteParts ?? []).filter(p => p.partType === PartType.FRAME), [noteParts]);
  useEffect(() => { // 元にできる内容：文字起こし済みの資料（ページごと）とノートの枠
    if (!item || !account) return; let live = true;
    (async () => {
      const ps: Part[] = [];
      for (const m of materials.filter(x => x.itemId === item.itemId && (x.fileType === "text" || x.fileType === "transcript"))) {
        const b = (await controller.handleRequest("G007", "getContent", { materialId: m.materialId })).data; if (typeof b === "string") chunkText(b).forEach((c, n) => ps.push({ id: `${m.materialId}:${n}`, label: `${m.fileName}　p.${n + 1}`, text: c, kind: "mat" }));
      }
      frames.forEach(p => { const t = frameText(p); if (t.trim()) ps.push({ id: p.partId, label: `${frameName(p)}　${t.slice(0, 16)}`, text: t, kind: "frame" }); });
      if (live) setParts(ps);
    })(); return () => { live = false; };
  }, [item?.itemId]); // eslint-disable-line
  if (!subject || !item) return <Redirect to={{ s: "G003" }} />;
  const choose = (ids: string[]) => { setSel(ids); setText(parts.filter(p => ids.includes(p.id)).map(p => p.text).join("\n\n")); setMsg(""); };
  const consume = (n: number) => { addLocalUsage(n); void refresh(); };
  /** 1万文字を超えるときは分けて送る＝利用回数を余分に消費する。確認して、送ってよければ回数を返す */
  const confirmCalls = async (): Promise<number | null> => {
    if (!sel.length || !text.trim()) { setMsg("送る内容を選んでください"); return null; }
    const n = calls(text.length);
    if (remaining !== null && n > remaining) { setMsg(n > 1 ? "残りの利用回数が足りないため、分けて送れません。送る内容を減らしてください" : "今日はこれ以上使えません"); return null; }
    if (n > 1 && await ask(`1万文字を超えているため、分けて送ると利用回数を余分に消費します（この内容では${n}回分）`, [{ label: "このまま送信", value: "ok", primary: true }, { label: "キャンセル", value: "no" }]) !== "ok") return null;
    return n;
  };
  const send = async () => {
    if (!types.length) return setMsg("枠の種類を選んでください");
    if (!online) return setMsg("インターネットにつながっていません。つながってから送信してください");
    const n = await confirmCalls(); if (!n) return; setBusy(true); setMsg("");
    // 11/20：Controller → AiSummaryManager.summarize でAIに送る（1万文字を超えたら分けて送る）
    const r = await controller.handleRequest("G007", "summarize", { studentId: account?.studentId ?? "", itemId: item.itemId, text, frameTypes: types, parts: noteParts ?? [] });
    setBusy(false);
    if (r.error) { setMsg(r.error); void refresh(); return; }
    const ps = r.data as Suggestion[]; consume(n); setProps(ps); setPick(ps.map((_, i) => i)); setTab("prop");
    if (!ps.length) setMsg("提案が作れませんでした。送る内容を見直してください");
  };
  const decide = async () => { const n = await confirmCalls(); if (!n) return; setTmp({ send: text, sendCalls: n }); nav({ s: "G008", subjectId: subject.subjectId, itemId: item.itemId }); };
  const approve = async () => {
    // 使うことにした提案だけを approved = true にして送る
    const ps = props.filter((_, i) => pick.includes(i)).map(p => new Suggestion({ ...p, approved: true }));
    if (ps.length && noteParts) {
      // 11/20：Controller → AiSummaryManager.mergeApproved で、選んだ提案を入れたノートを作ってもらう（枠が大きくなったら下の部品もずらす）
      const r = await controller.handleRequest("G007", "approve", { studentId: account?.studentId ?? "", itemId: item.itemId, parts: noteParts, suggestions: ps });
      if (r.error) return setMsg(r.error);
      setDraft(item.itemId, r.data as NotePart[]); // 反映するが保存はしない（学習画面の「保存」で保存）
    }
    toast(ps.length ? "提案をノートに反映したよ（保存は学習画面で）" : "提案をすべて捨てたよ"); nav({ s: "G004", subjectId: subject.subjectId, itemId: item.itemId });
  };
  const replace = () => { // 編集指示「元→先」
    const r = parseReplace(ins); if (!r) return setMsg("「元の文字→直した文字」の形で入力してください");
    const f = (s: string) => replaceText(s, r);
    if (tab === "prop") setProps(props.map(p => new Suggestion({ ...p, content: f(p.content) }))); else setText(f(text));
    setIns(""); setMsg("直しました");
  };
  const refText = parts.find(p => p.id === ref)?.text;
  const tabs: [typeof tab, string][] = essay ? [["src", "元にする内容"], ["send", "送る内容"]] : [["src", "元にする内容"], ["send", "送る内容"], ["prop", "提案"]];
  return <Shell center={<>
    <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={"chip" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>)}<span className="sp" />{essay && <button className="btn pri" onClick={decide}>決定</button>}</div>
    {tab === "src" && <div className="vbox">{parts.length === 0 && <p className="mute">元にできる内容がありません。資料をアップロードするか、ノートに枠を作ってください。</p>}
      {parts.length > 0 && <div className="row" style={{ marginBottom: 6 }}><button className="btn sm" onClick={() => choose(parts.map(p => p.id))}>すべて選択</button><button className="btn sm line" onClick={() => choose([])}>選択を外す</button></div>}
      {parts.map(p => <label key={p.id} className="ck"><input type="checkbox" checked={sel.includes(p.id)} onChange={e => choose(e.target.checked ? [...sel, p.id] : sel.filter(x => x !== p.id))} />{p.label}</label>)}
      <p className="mute">選び直すと、「送る内容」の編集はやり直しになります。</p></div>}
    {tab === "send" && <div className="vbox"><textarea className="tx" value={text} onChange={e => setText(e.target.value)} placeholder="ここに送る内容が入ります。送りたくない文字は削除してください" />
      <div className="mute">{text.length.toLocaleString()}文字（1回あたり1万文字まで）　※個人情報などは送らないでください。送った内容は、どこにも残りません。</div></div>}
    {tab === "prop" && <div className="vbox">{!props.length && <p className="mute">まだ提案がありません。「送る内容」から送信してください。</p>}
      {props.map((p, i) => { const cur = frames.find(f => f.partId === p.targetPartId); return (<div key={i} className="box" style={{ marginTop: 0, marginBottom: 8 }}>
        <label className="ck"><input type="checkbox" checked={pick.includes(i)} onChange={e => setPick(e.target.checked ? [...pick, i] : pick.filter(x => x !== i))} /><b>{frameName(p)}</b>　{cur ? "（もとの枠の書き換え）" : "（新しい枠）"}</label>
        <div className={cur ? "two" : ""}>{cur && <div><div className="mute">いまの中身</div><pre className="txt">{frameText(cur)}</pre></div>}
          <div>{cur && <div className="mute">提案</div>}<textarea className="tx" style={{ minHeight: 90 }} value={p.content}
            onChange={e => setProps(props.map((x, j) => j !== i ? x : new Suggestion({ ...x, content: e.target.value })))} /></div></div></div>); })}</div>}
    {set && !essay && <div className="pop"><h3>設定　振り分ける枠の種類</h3>{(Object.keys(FT) as FrameType[]).map(k => <label key={k} className="ck"><input type="checkbox" checked={types.includes(k)} onChange={e => setTypes(e.target.checked ? [...types, k] : types.filter(x => x !== k))} />{FT[k].n}</label>)}</div>}
    {set && essay && <div className="pop">記述テストに使う内容を決めます。AIの利用はテストを作るときです。</div>}
    <AiWait busy={busy} what="AIがまとめています" />
    <div className="mute" style={{ marginTop: 8 }}>今日の残り利用回数：{limit} 回中 {remaining ?? "…"} 回{!online && "　（オフラインのため、AIは使えません）"}</div>{msg && <div className="err">{msg}</div>}
    <div className="bar2 stick"><span className="row">{!essay && <button className="btn ai lg" disabled={busy || tab === "prop" || !online} onClick={send}>{busy ? "送信中…" : "送信"}</button>}<button className="btn line" onClick={() => setSet(!set)}>設定</button>
      {!essay && <button className="btn pri lg" disabled={tab !== "prop"} onClick={approve}>承認</button>}</span>
      <button className="btn line" onClick={async () => { if (tab === "prop" && props.length) { toast("提案をすべて捨てたよ"); } await go({ s: essay ? "G008" : "G004", subjectId: subject.subjectId, itemId: item.itemId }); }}>キャンセル</button></div></>}
    right={<><h3>参照</h3><div className="mute">ストレージの資料とノートの枠。押すと中身を見られます（AIの提案と見比べるとき）</div>
      <div className="col" style={{ gap: 2 }}>{parts.map(p => <button key={p.id} className="toc" onClick={() => setRef(p.id === ref ? null : p.id)}>{p.label}</button>)}</div>
      {refText && <pre className="txt" style={{ fontSize: 12, borderTop: "1px solid #cdbfe0", paddingTop: 6 }}>{refText}</pre>}
      <span className="sp" />{msg && <div className="mute">{msg}</div>}<input className="inp" placeholder="編集指示（例：兀→元）" value={ins} onChange={e => setIns(e.target.value)} onKeyDown={e => e.key === "Enter" && replace()} /></>} />;
}