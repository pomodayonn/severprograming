// G008 テスト作成 / G009 テスト解答 / G010 テスト結果 / G011 テスト一覧 
import { useMemo, useState } from "react";
import { useApp } from "../state/app";
import type { Test, TestKind } from "../types";
import { AI_LIMIT, dayKey, fmt, isCorrect, shuffle, uid, wordTest, wordsOf } from "../lib/logic";
import { explain, makeEssay } from "../services/ai";
import { Shell } from "./Shell";
import { toast } from "./toast";

const KIND: Record<TestKind, string> = { "w-m2t": "単語テスト（意味→用語）", "w-t2m": "単語テスト（用語→意味）", essay: "記述テスト" };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

export function TestCreate() {
  const { data, setData, route, nav, go, tmp, setTmp } = useApp();
  const subject = data.subjects.find(s => s.id === route.subjectId), item = subject?.items.find(i => i.id === route.itemId);
  const [scope, setScope] = useState<"all" | "pick">("all"), [picks, setPicks] = useState<string[]>([]), [kind, setKind] = useState<TestKind>("w-m2t"), [count, setCount] = useState(10), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  if (!subject || !item) { setTimeout(() => nav({ s: "G003" }), 0); return null; }
  const frames = item.note.els.filter(e => e.kind === "frame"), used = data.usage[dayKey()] ?? 0, send = (tmp.send as string | undefined) ?? "";
  const els = scope === "all" ? item.note.els : item.note.els.filter(e => picks.includes(e.id)), essay = kind === "essay";
  const make = async () => {
    setMsg(""); const n = Math.min(20, Math.max(5, Math.round(count) || 10)); let qs;
    if (!essay) {
      const ws = wordsOf(els); if (!ws.length) return setMsg("範囲に単語枠がない（または空）ため、先にノートで単語枠を作ってください");
      qs = wordTest(ws, kind, n); if (ws.length < n) toast(`単語が少ないので、ある分（${ws.length}問）だけ出題します`);
    } else {
      if (!send.trim()) return setMsg("先に「内容編集」で、送る内容を決めてください");
      const c = (tmp.sendCalls as number | undefined) ?? 1; if (used + c > AI_LIMIT) return setMsg("今日はこれ以上使えません");
      setBusy(true); try { qs = await makeEssay(send, n); } catch { setBusy(false); return setMsg("AIサービスが使えません。時間をおいて試してください"); } setBusy(false);
      if (!qs.length) return setMsg("問題を作れませんでした。送る内容を見直してください");
      setData(d => ({ ...d, usage: { ...d.usage, [dayKey()]: (d.usage[dayKey()] ?? 0) + c } })); setTmp({ send: "", sendCalls: 1 });
    }
    const t: Test = { id: uid(), itemId: item.id, kind, created: Date.now(), qs }; setData(d => ({ ...d, tests: [...d.tests, t] }));
    nav({ s: "G009", subjectId: subject.id, itemId: item.id, testId: t.id, mode: "new" }); // 問題だけを表示（模範解答・解説は出さない）
  };
  return <Shell center={<>
    <div className="vbox" style={{ minHeight: 360 }}><h3>模擬テストを作る　<span className="mute">{subject.name} ／ {item.name}</span></h3>
      <div className="two"><div><b>範囲</b><label className="ck"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />ノート丸ごと</label><label className="ck"><input type="radio" checked={scope === "pick"} onChange={() => setScope("pick")} />枠を選ぶ</label>
        {scope === "pick" && <div className="pop">{frames.map(e => <label key={e.id} className="ck"><input type="checkbox" checked={picks.includes(e.id)} onChange={x => setPicks(x.target.checked ? [...picks, e.id] : picks.filter(p => p !== e.id))} />{e.ft === "word" ? `単語枠　${e.words?.[0]?.term ?? ""}` : `${e.text.slice(0, 14)}`}</label>)}{!frames.length && <span className="mute">枠がありません</span>}</div>}</div>
        <div><b>テストの種類</b>{(Object.keys(KIND) as TestKind[]).map(k => <label key={k} className="ck"><input type="radio" checked={kind === k} onChange={() => setKind(k)} />{KIND[k]}</label>)}
          <b>問題数（5〜20問）</b><input className="inp" type="number" min={5} max={20} value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 100 }} />
          {essay && <div className="mute">送る内容：{send ? `${send.length.toLocaleString()}文字を決定済み` : "まだ決めていません"}<br />今日の残り利用回数：{AI_LIMIT} 回中 {Math.max(0, AI_LIMIT - used)} 回</div>}</div></div>
      {msg && <div className="err">{msg}</div>}</div>
    <div className="bar2"><span className="row"><button className="btn" disabled={busy} onClick={make}>{busy ? "作成中…" : "作成"}</button>
      <button className="btn line" disabled={!essay} onClick={() => go({ s: "G007", subjectId: subject.id, itemId: item.id, purpose: "essay" })}>内容編集</button></span>
      <button className="btn" onClick={() => go({ s: "G004", subjectId: subject.id, itemId: item.id })}>戻る</button></div></>} />;
}

export function TestAnswer() {
  const { data, setData, route, nav, ask } = useApp();
  const test = data.tests.find(t => t.id === route.testId), retry = route.mode === "retry";
  const [idx, setIdx] = useState(0), [ans, setAns] = useState<string[]>(() => test?.qs.map(() => "") ?? []), [kb, setKb] = useState(test?.kind === "essay");
  const pool = useMemo(() => test ? test.qs.map(q => q.a) : [], [test]);
  const choices = useMemo(() => !test || test.kind === "essay" ? [] : shuffle([pool[idx], ...shuffle([...new Set(pool.filter((_, i) => i !== idx))]).slice(0, 3)]), [test, idx, pool]); // eslint-disable-line
  if (!test) { setTimeout(() => nav({ s: "G003" }), 0); return null; }
  const base = { subjectId: route.subjectId, itemId: route.itemId };
  const leave = () => nav({ s: retry ? "G011" : "G004", ...base });
  const done = async () => {
    const un = ans.filter(a => !a.trim()).length;
    if (un && await ask("答えていない問題があります。確定しますか", [{ label: "確定", value: "ok", primary: true }, { label: "戻る", value: "no" }]) !== "ok") return;
    const ok = test.kind === "w-m2t" ? test.qs.map((q, i) => isCorrect(ans[i], q.a)) : undefined; // 採点するのは「意味→用語」だけ
    if (!retry) setData(d => ({ ...d, tests: d.tests.map(t => t.id === test.id ? { ...t, ans, ok, last: Date.now() } : t) })); // 解き直しの解答は保存しない
    nav({ s: "G010", ...base, testId: test.id, mode: retry ? "retry" : "new", ans, ok });
  };
  const quit = async () => { if (await ask("今回の解答は保存されません。やめますか", [{ label: "やめる", value: "ok", primary: true }, { label: "続ける", value: "no" }]) === "ok") leave(); };
  const set = (v: string) => setAns(ans.map((a, i) => i === idx ? v : a));
  return <Shell right={<><div className="col">{test.qs.map((_, i) => <div key={i} className={"qn" + (i === idx ? " on" : "")} onClick={() => setIdx(i)}><i />第{i + 1}問{ans[i].trim() ? "　✓" : ""}</div>)}</div><span className="sp" /><button className="btn round fill" onClick={done}>解答</button></>}
    center={<>
      <div className="mute">{KIND[test.kind]}{retry ? "（解き直し：この回の解答は保存されません）" : ""}　問 {idx + 1} / {test.qs.length}</div>
      <div className="vbox" style={{ marginTop: 6 }}><h3>第{idx + 1}問</h3><div style={{ fontSize: 17 }}>{test.qs[idx].q}</div>
        {!kb && choices.length > 0 && <div className="choices">{choices.map((c, i) => <button key={i} className={"choice" + (ans[idx] === c ? " on" : "")} onClick={() => set(c)}>選択{i + 1}<br /><small>{c}</small></button>)}</div>}
        {(kb || test.kind === "essay") && <textarea className="tx" style={{ minHeight: 110, marginTop: 10 }} value={ans[idx]} onChange={e => set(e.target.value)} placeholder="答えを入力" />}</div>
      <div className="bar2"><span className="row"><button className="btn line round" onClick={() => { toast("テストを保存したよ"); nav({ s: "G011", ...base }); }}>保存</button><button className="btn line round" onClick={quit}>やめる</button></span>
        {test.kind !== "essay" && <button className="btn line" onClick={() => setKb(!kb)}>{kb ? "選択肢にもどす" : "キーボード"}</button>}</div></>} />;
}

export function TestResult() {
  const { data, setData, route, nav, go } = useApp();
  const test = data.tests.find(t => t.id === route.testId), [idx, setIdx] = useState(0), [msg, setMsg] = useState("");
  if (!test) { setTimeout(() => nav({ s: "G003" }), 0); return null; }
  const list = route.mode === "list", ans = list ? test.ans : route.ans, ok = list ? test.ok : route.ok, q = test.qs[idx], used = data.usage[dayKey()] ?? 0;
  const base = { subjectId: route.subjectId, itemId: route.itemId };
  const expl = async () => {
    if (q.expl) return; if (used >= AI_LIMIT) return setMsg("今日はこれ以上使えません");
    try { const e = await explain(q); setData(d => ({ ...d, usage: { ...d.usage, [dayKey()]: (d.usage[dayKey()] ?? 0) + 1 }, tests: d.tests.map(t => t.id === test.id ? { ...t, qs: t.qs.map((x, i) => i === idx ? { ...x, expl: e } : x) } : t) })); setMsg(""); }
    catch { setMsg("AIサービスが使えません。時間をおいて試してください"); }
  };
  return <Shell right={<><div className="box" style={{ marginTop: 0 }}><h3>模範解答</h3><div>{ans || list ? q.a : "（解答するとここに表示されます）"}</div></div>
      <button className="btn" style={{ alignSelf: "flex-end" }} onClick={expl}>解説</button>{q.expl && <div className="pop">{q.expl}</div>}{msg && <div className="err">{msg}</div>}</>}
    center={<>
      <div className="row"><h2 style={{ margin: 0 }}>結果</h2>{ok && <b>{ok.filter(Boolean).length} / {test.qs.length} 問正解</b>}<span className="mute">{KIND[test.kind]}{list ? `　最後に解いた日時 ${fmt(test.last)}` : ""}</span></div>
      <div className="qtabs" style={{ marginTop: 8 }}>{test.qs.map((_, i) => <button key={i} className={"btn sm" + (i === idx ? " fill" : " line")} onClick={() => { setIdx(i); setMsg(""); }}>第{i + 1}問</button>)}</div>
      <div className="vbox"><h3>自身の回答</h3><div className="mute">問題</div><div style={{ marginBottom: 8 }}>{q.q}</div>
        {ans ? <div style={{ whiteSpace: "pre-wrap" }}>{ans[idx] || "（未回答）"}　{ok && (ok[idx] ? <span className="ok">正解</span> : <span className="ng">不正解</span>)}</div> : <p className="mute">まだ解いていません。「解き直し」で解けます。</p>}</div>
      <div className="bar2"><button className="btn line round" onClick={() => go({ s: "G004", ...base })}>終了</button><button className="btn round fill" onClick={() => go({ s: "G011", ...base })}>戻る</button></div></>} />;
}

export function TestList() {
  const { data, route, nav } = useApp();
  const [sid, setSid] = useState(route.subjectId ?? data.subjects[0]?.id), [sel, setSel] = useState<string | null>(null);
  const subject = data.subjects.find(s => s.id === sid);
  const rows = (subject?.items ?? []).flatMap(i => data.tests.filter(t => t.itemId === i.id).map(t => ({ t, i }))).sort((a, b) => b.t.created - a.t.created);
  const base = (t?: Test) => ({ subjectId: sid, itemId: t?.itemId ?? route.itemId });
  return <Shell center={<>
    <div className="folders">{data.subjects.map(s => <div key={s.id} className={"folder" + (s.id === sid ? " on" : "")} onClick={() => { setSid(s.id); setSel(null); }}><i />{s.name}</div>)}</div>
    <div className="vbox" style={{ minHeight: 220 }}>{rows.length === 0 && <p className="mute">テストがまだありません。</p>}
      {rows.map(({ t, i }) => <div key={t.id} className={"trow" + (sel === t.id ? " on" : "")} onClick={() => setSel(t.id)}><i className="dot" /><span>{i.name}-{ymd(t.created)}</span><span className="mute">{KIND[t.kind]}／{t.qs.length}問／最後に解いた日時 {fmt(t.last)}</span></div>)}</div>
    <div className="bar2"><span className="row"><button className="btn line round" disabled={!sel} onClick={() => nav({ s: "G010", ...base(rows.find(r => r.t.id === sel)?.t), testId: sel!, mode: "list" })}>結果表示</button>
      <button className="btn line round" disabled={!sel} onClick={() => nav({ s: "G009", ...base(rows.find(r => r.t.id === sel)?.t), testId: sel!, mode: "retry" })}>解き直し</button></span>
      <button className="btn round fill" onClick={() => nav({ s: "G004", subjectId: route.subjectId ?? sid, itemId: route.itemId })}>戻る</button></div></>} />;
}
