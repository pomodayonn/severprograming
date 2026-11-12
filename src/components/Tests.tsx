// G008 テスト作成 / G009 テスト解答 / G010 テスト結果 / G011 テスト一覧
// 11/12：テストの作成・解答（採点と保存）・解説を Controller → TestManager 経由にした（A）。
// 解き直しも毎回「受験」として保存する（要件定義書 UC-023・UC-027）。
// 11/12：G010 に「直す」（問題と模範解答・自分の解答・解説、AIで直す）と、過去の受験を選ぶ機能を追加（UC-026・UC-028）。
// ほかの画面がまだ data.tests を使っているので、Manager で成功したら data.tests にも同じ変更を入れる（移行中のつなぎ）
import { useEffect, useMemo, useState } from "react";
import { Redirect, useApp } from "../state/app";
import type { Test, TestKind } from "../types";
import { fmt, shuffle } from "../lib/logic";
import { addLocalUsage, useAiRemaining } from "../services/ai";
import { controller } from "../controller/Controller";
import { Shell } from "./Shell";
import { toast } from "./toast";

const KIND: Record<TestKind, string> = { "w-m2t": "単語テスト（意味→用語）", "w-t2m": "単語テスト（用語→意味）", essay: "記述テスト" };
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

export function TestCreate() {
  const { data, setData, route, nav, go, tmp, setTmp, account } = useApp();
  const subject = data.subjects.find(s => s.id === route.subjectId), item = subject?.items.find(i => i.id === route.itemId);
  const [scope, setScope] = useState<"all" | "pick">("all"), [picks, setPicks] = useState<string[]>([]), [kind, setKind] = useState<TestKind>("w-m2t"), [count, setCount] = useState(10), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const { remaining, limit, refresh } = useAiRemaining(data.usage);
  if (!subject || !item) return <Redirect to={{ s: "G003" }} />;
  const frames = item.note.els.filter(e => e.kind === "frame"), send = (tmp.send as string | undefined) ?? "";
  const els = scope === "all" ? item.note.els : item.note.els.filter(e => picks.includes(e.id)), essay = kind === "essay";
  const make = async () => {
    setMsg(""); const n = Math.min(20, Math.max(5, Math.round(count) || 10)); let t: Test;
    if (!essay) {
      if (scope === "pick" && !picks.length) return setMsg("範囲に単語枠がない（または空）ため、先にノートで単語枠を作ってください");
      const r = await controller.handleRequest("G008", "createWordTest", { studentId: account?.id ?? "", itemId: item.id, kind, count: String(n), partIds: scope === "pick" ? picks.join(",") : "" });
      if (r.error) return setMsg(r.error);
      const d = r.data as { test: Test; shortage: number }; t = d.test;
      if (d.shortage > 0) toast(`単語が少ないので、ある分（${t.qs.length}問）だけ出題します`);
    } else {
      if (!send.trim()) return setMsg("先に「内容編集」で、送る内容を決めてください");
      const c = (tmp.sendCalls as number | undefined) ?? 1; if (remaining !== null && c > remaining) return setMsg("今日はこれ以上使えません");
      setBusy(true);
      const r = await controller.handleRequest("G008", "createEssayTest", { studentId: account?.id ?? "", itemId: item.id, text: send, count: String(n) });
      setBusy(false); void refresh();
      if (r.error) return setMsg(r.error);
      t = r.data as Test;
      setData(d => ({ ...d, usage: addLocalUsage(d.usage, c) })); setTmp({ send: "", sendCalls: 1 });
    }
    setData(d => ({ ...d, tests: [...d.tests, t] }));
    nav({ s: "G009", subjectId: subject.id, itemId: item.id, testId: t.id, mode: "new" }); // 問題だけを表示（模範解答・解説は出さない）
  };
  return <Shell center={<>
    <div className="vbox" style={{ minHeight: 360 }}><h3>模擬テストを作る　<span className="mute">{subject.name} ／ {item.name}</span></h3>
      <div className="two"><div><b>範囲</b><label className="ck"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />ノート丸ごと</label><label className="ck"><input type="radio" checked={scope === "pick"} onChange={() => setScope("pick")} />枠を選ぶ</label>
        {scope === "pick" && <div className="pop">{frames.map(e => <label key={e.id} className="ck"><input type="checkbox" checked={picks.includes(e.id)} onChange={x => setPicks(x.target.checked ? [...picks, e.id] : picks.filter(p => p !== e.id))} />{e.ft === "word" ? `単語枠　${e.words?.[0]?.term ?? ""}` : `${e.text.slice(0, 14)}`}</label>)}{!frames.length && <span className="mute">枠がありません</span>}</div>}</div>
        <div><b>テストの種類</b>{(Object.keys(KIND) as TestKind[]).map(k => <label key={k} className="ck"><input type="radio" checked={kind === k} onChange={() => setKind(k)} />{KIND[k]}</label>)}
          <b>問題数（5〜20問）</b><input className="inp" type="number" min={5} max={20} value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 100 }} />
          {essay && <div className="mute">送る内容：{send ? `${send.length.toLocaleString()}文字を決定済み` : "まだ決めていません"}<br />今日の残り利用回数：{limit} 回中 {remaining ?? "…"} 回</div>}</div></div>
      {msg && <div className="err">{msg}</div>}</div>
    <div className="bar2"><span className="row"><button className="btn" disabled={busy} onClick={make}>{busy ? "作成中…" : "作成"}</button>
      <button className="btn line" disabled={!essay} onClick={() => go({ s: "G007", subjectId: subject.id, itemId: item.id, purpose: "essay" })}>内容編集</button></span>
      <button className="btn" onClick={() => go({ s: "G004", subjectId: subject.id, itemId: item.id })}>戻る</button></div></>} />;
}

export function TestAnswer() {
  const { data, setData, route, nav, ask } = useApp();
  const test = data.tests.find(t => t.id === route.testId), retry = route.mode === "retry";
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0), [ans, setAns] = useState<string[]>(() => test?.qs.map(() => "") ?? []), [kb, setKb] = useState(test?.kind === "essay");
  const pool = useMemo(() => test ? test.qs.map(q => q.a) : [], [test]);
  const choices = useMemo(() => !test || test.kind === "essay" ? [] : shuffle([pool[idx], ...shuffle([...new Set(pool.filter((_, i) => i !== idx))]).slice(0, 3)]), [test, idx, pool]); // eslint-disable-line
  if (!test) return <Redirect to={{ s: "G003" }} />;
  const base = { subjectId: route.subjectId, itemId: route.itemId };
  const leave = () => nav({ s: retry ? "G011" : "G004", ...base });
  const done = async () => {
    const un = ans.filter(a => !a.trim()).length;
    if (un && await ask("答えていない問題があります。確定しますか", [{ label: "確定", value: "ok", primary: true }, { label: "戻る", value: "no" }]) !== "ok") return;
    // TestManager が新しい受験として保存し、「意味→用語」なら採点する（解き直しも保存する）
    setBusy(true); const r = await controller.handleRequest("G009", "submit", { testId: test.id, answers: JSON.stringify(ans) }); setBusy(false);
    if (r.error) return toast(r.error);
    const saved = r.data as Test;
    setData(d => ({ ...d, tests: d.tests.map(t => t.id === test.id ? saved : t) }));
    nav({ s: "G010", ...base, testId: test.id, mode: retry ? "retry" : "new", ans: saved.ans, ok: saved.ok });
  };
  const quit = async () => { if (await ask("今回の解答は保存されません。やめますか", [{ label: "やめる", value: "ok", primary: true }, { label: "続ける", value: "no" }]) === "ok") leave(); };
  const set = (v: string) => setAns(ans.map((a, i) => i === idx ? v : a));
  return <Shell right={<><div className="col">{test.qs.map((_, i) => <div key={i} className={"qn" + (i === idx ? " on" : "")} onClick={() => setIdx(i)}><i />第{i + 1}問{ans[i].trim() ? "　✓" : ""}</div>)}</div><span className="sp" /><button className="btn round fill" disabled={busy} onClick={done}>{busy ? "保存中…" : "解答"}</button></>}
    center={<>
      <div className="mute">{KIND[test.kind]}{retry ? "（解き直し：解答は新しい回として保存されます）" : ""}　問 {idx + 1} / {test.qs.length}</div>
      <div className="vbox" style={{ marginTop: 6 }}><h3>第{idx + 1}問</h3><div style={{ fontSize: 17 }}>{test.qs[idx].q}</div>
        {!kb && choices.length > 0 && <div className="choices">{choices.map((c, i) => <button key={i} className={"choice" + (ans[idx] === c ? " on" : "")} onClick={() => set(c)}>選択{i + 1}<br /><small>{c}</small></button>)}</div>}
        {(kb || test.kind === "essay") && <textarea className="tx" style={{ minHeight: 110, marginTop: 10 }} value={ans[idx]} onChange={e => set(e.target.value)} placeholder="答えを入力" />}</div>
      <div className="bar2"><span className="row"><button className="btn line round" onClick={() => { toast("テストを保存したよ"); nav({ s: "G011", ...base }); }}>保存</button><button className="btn line round" onClick={quit}>やめる</button></span>
        {test.kind !== "essay" && <button className="btn line" onClick={() => setKb(!kb)}>{kb ? "選択肢にもどす" : "キーボード"}</button>}</div></>} />;
}

/** 1回分の受験（何回目・日時・解答・正誤） */
interface Att { no: number; at: number; ans: string[]; ok?: boolean[] }
/** 直す対象：問題と模範解答／自分の解答／解説 */
type Fix = "question" | "answer" | "expl";

export function TestResult() {
  const { data, setData, route, go } = useApp();
  const test = data.tests.find(t => t.id === route.testId), [idx, setIdx] = useState(0), [msg, setMsg] = useState("");
  const { remaining, refresh } = useAiRemaining(data.usage);
  // 過去の受験（1回目から順に）と、いま表示している回
  const [atts, setAtts] = useState<Att[]>([]), [no, setNo] = useState(0);
  // 直す（G010）：直す対象・書き直し欄・追加の指示
  const [fix, setFix] = useState<Fix | null>(null), [f1, setF1] = useState(""), [f2, setF2] = useState(""), [extra, setExtra] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!test) return;
    void controller.handleRequest("G010", "getAttempts", { testId: test.id }).then(r => {
      if (r.data) { const a = r.data as Att[]; setAtts(a); setNo(a.length ? a[a.length - 1].no : 0); }
    });
  }, [test?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!test) return <Redirect to={{ s: "G003" }} />;
  const list = route.mode === "list", q = test.qs[idx], base = { subjectId: route.subjectId, itemId: route.itemId };
  const att = atts.find(a => a.no === no);
  const ans = att?.ans ?? (list ? test.ans : route.ans), ok = att ? att.ok : (list ? test.ok : route.ok);
  const essay = test.kind === "essay", canAnswer = test.kind !== "w-m2t" && !!att;
  const mirror = (t: Test) => setData(d => ({ ...d, tests: d.tests.map(x => x.id === t.id ? t : x) }));
  const useAi = () => { setData(d => ({ ...d, usage: addLocalUsage(d.usage, 1) })); void refresh(); };
  const expl = async () => {
    if (q.expl) return; if (remaining !== null && remaining < 1) return setMsg("今日はこれ以上使えません");
    const r = await controller.handleRequest("G010", "explain", { testId: test.id, index: String(idx) }); void refresh();
    if (r.error) return setMsg(r.error);
    const e = r.data as string;
    setData(d => ({ ...d, usage: addLocalUsage(d.usage, 1), tests: d.tests.map(t => t.id === test.id ? { ...t, qs: t.qs.map((x, i) => i === idx ? { ...x, expl: e } : x) } : t) })); setMsg("");
  };
  // 「直す」：対象を選ぶと、いまの内容を書き直し欄に入れる
  const open = (f: Fix) => {
    setFix(f); setMsg(""); setExtra("");
    if (f === "question") { setF1(q.q); setF2(q.a); } else if (f === "answer") { setF1(ans?.[idx] ?? ""); setF2(""); } else { setF1(q.expl ?? ""); setF2(""); }
  };
  const close = () => { setFix(null); setMsg(""); };
  const saveFix = async () => {
    if (!fix) return; setBusy(true);
    const p = { testId: test.id, index: String(idx) };
    const r = fix === "question" ? await controller.handleRequest("G010", "editQuestion", { ...p, question: f1, modelAnswer: f2 })
      : fix === "answer" ? await controller.handleRequest("G010", "editAnswer", { ...p, attemptNo: String(no), answer: f1 })
      : await controller.handleRequest("G010", "editExplanation", { ...p, explanation: f1 });
    setBusy(false);
    if (r.error) return setMsg(r.error);
    if (fix === "answer") { const d = r.data as { test: Test; attempts: Att[] }; mirror(d.test); setAtts(d.attempts); } else mirror(r.data as Test);
    close(); toast("直したよ");
  };
  const aiFix = async () => {
    if (fix !== "question" && fix !== "expl") return;
    if (remaining !== null && remaining < 1) return setMsg("今日はこれ以上使えません");
    setBusy(true);
    const r = await controller.handleRequest("G010", fix === "question" ? "regenerateQuestion" : "regenerateExplanation", { testId: test.id, index: String(idx), extra });
    setBusy(false);
    if (r.error) { void refresh(); return setMsg(r.error); }
    useAi(); const t = r.data as Test; mirror(t);
    if (fix === "question") { setF1(t.qs[idx].q); setF2(t.qs[idx].a); } else setF1(t.qs[idx].expl ?? "");
    setMsg(""); toast("AIで直して保存したよ");
  };
  return <Shell right={<><div className="box" style={{ marginTop: 0 }}><h3>模範解答</h3><div>{ans || list ? q.a : "（解答するとここに表示されます）"}</div></div>
      <span className="row" style={{ alignSelf: "flex-end" }}><button className="btn line" onClick={() => fix ? close() : open(essay ? "question" : canAnswer ? "answer" : "expl")}>{fix ? "直すのをやめる" : "直す"}</button><button className="btn" onClick={expl}>解説</button></span>
      {q.expl && <div className="pop" style={{ whiteSpace: "pre-wrap" }}>{q.expl}</div>}
      {fix && <div className="pop">
        <b>直す内容</b>
        <label className="ck"><input type="radio" checked={fix === "question"} disabled={!essay} onChange={() => open("question")} />問題と模範解答</label>
        <label className="ck"><input type="radio" checked={fix === "answer"} disabled={!canAnswer} onChange={() => open("answer")} />自分の解答{att ? `（第${att.no}回）` : ""}</label>
        <label className="ck"><input type="radio" checked={fix === "expl"} onChange={() => open("expl")} />解説</label>
        {!essay && <div className="mute">単語テストの問題は、ノートの単語枠で直してください{test.kind === "w-m2t" ? "。「意味→用語」は採点があるので、自分の解答は直せません" : ""}</div>}
        {fix === "question" && <><div className="mute">問題</div><textarea className="tx" rows={3} style={{ minHeight: 0, height: "auto" }} value={f1} onChange={e => setF1(e.target.value)} /><div className="mute">模範解答</div><textarea className="tx" rows={3} style={{ minHeight: 0, height: "auto" }} value={f2} onChange={e => setF2(e.target.value)} /></>}
        {fix !== "question" && <textarea className="tx" rows={4} style={{ minHeight: 0, height: "auto" }} value={f1} onChange={e => setF1(e.target.value)} placeholder={fix === "expl" ? "解説を入力" : "解答を入力"} />}
        {fix !== "answer" && <><div className="mute">AIへの追加の指示（空なら最初から作り直す）</div><input className="inp" value={extra} onChange={e => setExtra(e.target.value)} placeholder="例：もっと短く" /></>}
        <span className="row"><button className="btn fill" disabled={busy} onClick={saveFix}>保存</button>{fix !== "answer" && <button className="btn line" disabled={busy} onClick={aiFix}>{busy ? "作成中…" : "AIで直す"}</button>}</span>
      </div>}
      {msg && <div className="err">{msg}</div>}</>}
    center={<>
      <div className="row"><h2 style={{ margin: 0 }}>結果</h2>{ok && <b>{ok.filter(Boolean).length} / {test.qs.length} 問正解</b>}<span className="mute">{KIND[test.kind]}{att ? `　第${att.no}回　${fmt(att.at)}` : list ? `　最後に解いた日時 ${fmt(test.last)}` : ""}</span>
        {atts.length > 1 && <select className="inp" style={{ width: "auto", display: "inline-block", margin: 0 }} value={no} onChange={e => { setNo(Number(e.target.value)); close(); }} aria-label="受験を選ぶ">{atts.map(a => <option key={a.no} value={a.no}>第{a.no}回（{fmt(a.at)}）</option>)}</select>}</div>
      <div className="qtabs" style={{ marginTop: 8 }}>{test.qs.map((_, i) => <button key={i} className={"btn sm" + (i === idx ? " fill" : " line")} onClick={() => { setIdx(i); close(); }}>第{i + 1}問</button>)}</div>
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