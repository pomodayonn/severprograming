// G008 テスト作成 / G009 テスト解答 / G010 テスト結果 / G011 テスト一覧
// 11/12：テストの作成・解答（採点と保存）・解説を Controller → TestManager 経由にした（A）。
// 解き直しも毎回「受験」として保存する（要件定義書 UC-023・UC-027）。
// 11/12：G010 に「直す」（問題と模範解答・自分の解答・解説、AIで直す）と、過去の受験を選ぶ機能を追加（UC-026・UC-028）。
// 11/21：テストと科目は useApp の tests・subjects（Manager から読んだもの）を見る。成功したら reload() で読み直す
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
//
// 【このファイルで何が起きているか】
// テストの4画面がこのファイルに入っている。
// ・TestCreate（G008）：範囲・種類・問題数を選んで「作成」→ Controller（G008:createWordTest / createEssayTest）
// ・TestAnswer（G009）：1問ずつ解く。選択肢かキーボードで答え、「解答」→ Controller（G009:submit）が採点して保存
// ・TestResult（G010）：結果を見る。「解説」でAIの解説、「直す」で問題・自分の解答・解説を書き直す。過去の回も選べる
// ・TestList  （G011）：その科目のテストの一覧。「結果表示」「解き直し」
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useApp } from "../state/app";
import { clampQuestionCount, fmt, shuffle } from "../lib/logic";
import { answerOf, attemptsOf, itemsOf, partsOf, questionsOf } from "../lib/select";
import { addLocalUsage, useAiRemaining } from "../services/ai";
import { controller } from "../controller/Controller";
import type { Test } from "../beans/Test";
import type { Question } from "../beans/Question";
import type { Attempt } from "../beans/Attempt";
import { TestType } from "../enums/TestType";
import { PartType } from "../enums/PartType";
import { AiWait, useOnline } from "./AiWait";
import { Shell } from "./Shell";
import { toast } from "./toast";

/** テストの種類の名前（画面に出す） */
const KIND: Record<TestType, string> = { [TestType.MEANING_TO_TERM]: "単語テスト（意味→用語）", [TestType.TERM_TO_MEANING]: "単語テスト（用語→意味）", [TestType.ESSAY]: "記述テスト" };
const KINDS = [TestType.MEANING_TO_TERM, TestType.TERM_TO_MEANING, TestType.ESSAY];
/** テスト名に使う日付（例：20261121） */
const ymd = (t: string) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };

export function TestCreate() {
  const { subjects, items, notes, reload, route, nav, go, tmp, setTmp, account } = useApp();
  const online = useOnline();
  const subject = subjects.find(s => s.subjectId === route.subjectId), item = itemsOf(items, route.subjectId).find(i => i.itemId === route.itemId);
  // 11/21：「内容編集」（G007）から戻ったときに選び直さなくてよいように、選んだ範囲・種類・問題数を tmp.g8 に残しておく（同じ学習項目のときだけ使う）
  const kept = tmp.g8 as G8Choice | undefined, k = kept?.itemId === route.itemId ? kept : undefined;
  const [scope, setScope] = useState<"all" | "pick">(k?.scope ?? "all"), [picks, setPicks] = useState<string[]>(k?.picks ?? []), [kind, setKind] = useState<TestType>(k?.kind ?? TestType.MEANING_TO_TERM), [count, setCount] = useState(k?.count ?? 10), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const { remaining, limit, refresh } = useAiRemaining();
  if (!subject || !item) return <Redirect to={{ s: "G003" }} />;
  const frames = partsOf(notes, item.itemId).filter(p => p.partType === PartType.FRAME), send = (tmp.send as string | undefined) ?? "";
  const essay = kind === TestType.ESSAY;
  const make = async () => {
    setMsg(""); const n = clampQuestionCount(count); let t: Test;
    if (kind !== TestType.ESSAY) {
      if (scope === "pick" && !picks.length) return setMsg("範囲に単語枠がない（または空）ため、先にノートで単語枠を作ってください");
      const r = await controller.handleRequest("G008", "createWordTest", { studentId: account?.studentId ?? "", itemId: item.itemId, testType: kind, count: n, partIds: scope === "pick" ? picks : undefined });
      if (r.error) return setMsg(r.error);
      const d = r.data as { test: Test; shortage: number }; t = d.test;
      if (d.shortage > 0) toast(`単語が少ないので、ある分（${t.questions.length}問）だけ出題します`);
    } else {
      if (!send.trim()) return setMsg("先に「内容編集」で、送る内容を決めてください");
      if (!online) return setMsg("インターネットにつながっていません。記述テストはAIで作るので、つながってから試してください");
      const c = (tmp.sendCalls as number | undefined) ?? 1; if (remaining !== null && c > remaining) return setMsg("今日はこれ以上使えません");
      setBusy(true);
      const r = await controller.handleRequest("G008", "createEssayTest", { studentId: account?.studentId ?? "", itemId: item.itemId, text: send, count: n });
      setBusy(false); void refresh();
      if (r.error) return setMsg(r.error);
      t = r.data as Test;
      addLocalUsage(c); setTmp({ send: "", sendCalls: 1 });
    }
    setTmp({ g8: undefined }); // 作ったら、次に開いたときは最初の選び方に戻す
    await reload();
    nav({ s: "G009", subjectId: subject.subjectId, itemId: item.itemId, testId: t.testId, mode: "new" }); // 問題だけを表示（模範解答・解説は出さない）
  };
  return <Shell center={<>
    <div className="vbox" style={{ minHeight: 360 }}><h3>模擬テストを作る　<span className="mute">{subject.subjectName} ／ {item.itemName}</span></h3>
      <div className="two"><div><b>範囲</b><label className="ck"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />ノート丸ごと</label><label className="ck"><input type="radio" checked={scope === "pick"} onChange={() => setScope("pick")} />枠を選ぶ</label>
        {scope === "pick" && <div className="pop">{frames.map(p => <label key={p.partId} className="ck"><input type="checkbox" checked={picks.includes(p.partId)} onChange={x => setPicks(x.target.checked ? [...picks, p.partId] : picks.filter(id => id !== p.partId))} />{p.frameType === "word" ? `単語枠　${p.words[0]?.term ?? ""}` : `${p.text.slice(0, 14)}`}</label>)}{!frames.length && <span className="mute">枠がありません</span>}</div>}</div>
        <div><b>テストの種類</b>{KINDS.map(t => <label key={t} className="ck"><input type="radio" checked={kind === t} onChange={() => setKind(t)} />{KIND[t]}</label>)}
          <b>問題数（5〜20問）</b><input className="inp" type="number" min={5} max={20} value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 100 }} />
          {essay && <div className="mute">送る内容：{send ? `${send.length.toLocaleString()}文字を決定済み` : "まだ決めていません"}<br />今日の残り利用回数：{limit} 回中 {remaining ?? "…"} 回</div>}</div></div>
      <AiWait busy={busy && essay} what="AIが問題を作っています" />
      {msg && <div className="err">{msg}</div>}</div>
    <div className="bar2"><span className="row"><button className={"btn lg " + (essay ? "ai" : "pri")} disabled={busy || (essay && !online)} onClick={make}>{busy ? "作成中…" : "作成"}</button>
      <button className="btn line" disabled={!essay} onClick={() => { setTmp({ g8: { itemId: item.itemId, scope, picks, kind, count } satisfies G8Choice }); void go({ s: "G007", subjectId: subject.subjectId, itemId: item.itemId, purpose: "essay" }); }}>内容編集</button></span>
      <button className="btn line" onClick={() => go({ s: "G004", subjectId: subject.subjectId, itemId: item.itemId })}>戻る</button></div></>} />;
}

/** テスト作成画面（G008）で選んだもの。G007 に行って戻ったときに元に戻すために tmp.g8 に置く */
interface G8Choice { itemId: string; scope: "all" | "pick"; picks: string[]; kind: TestType; count: number }

export function TestAnswer() {
  const { tests, reload, route, nav, ask } = useApp();
  const test = tests.find(t => t.testId === route.testId), retry = route.mode === "retry";
  const qs = useMemo(() => test ? questionsOf(test) : [], [test]); // 問題（番号の順）。解答もこの順に並べる
  const essay = test?.testType === TestType.ESSAY;
  const [busy, setBusy] = useState(false);
  const keys = useRef<{ next: () => void; prev: () => void; choose: (n: number) => void; essay: boolean } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [idx, setIdx] = useState(0), [ans, setAns] = useState<string[]>(() => qs.map(() => "")), [kb, setKb] = useState(essay);
  const pool = useMemo(() => qs.map(q => q.modelAnswer), [qs]);
  const choices = useMemo(() => essay ? [] : shuffle([pool[idx], ...shuffle([...new Set(pool.filter((_, i) => i !== idx))]).slice(0, 3)]), [essay, idx, pool]); // eslint-disable-line
  // キーボード：Enter＝次の問題（記述・入力欄の中では Ctrl＋Enter）、1〜4＝選択肢を選ぶ、← →＝前・次の問題
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current; if (!k || document.querySelector(".ov")) return; // 確認ダイアログが出ている間は何もしない
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (e.key === "Enter" && (!typing || !k.essay || e.ctrlKey || e.metaKey)) { e.preventDefault(); k.next(); return; }
      if (typing) return;
      if (/^[1-4]$/.test(e.key)) k.choose(Number(e.key) - 1);
      else if (e.key === "ArrowRight") k.next();
      else if (e.key === "ArrowLeft") k.prev();
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { box.current?.focus(); }, [idx, kb]); // 問題が変わったら、入力欄にすぐ打てるようにする
  if (!test) return <Redirect to={{ s: "G003" }} />;
  const base = { subjectId: route.subjectId, itemId: route.itemId };
  const done = async () => {
    const un = ans.filter(a => !a.trim()).length;
    if (un && await ask("答えていない問題があります。確定しますか", [{ label: "確定", value: "ok", primary: true }, { label: "戻る", value: "no" }]) !== "ok") return;
    // TestManager が新しい受験として保存し、「意味→用語」なら採点する（解き直しも保存する）
    setBusy(true); const r = await controller.handleRequest("G009", "submit", { testId: test.testId, answers: ans }); setBusy(false);
    if (r.error) return toast(r.error);
    await reload();
    nav({ s: "G010", ...base, testId: test.testId, mode: retry ? "retry" : "new" }); // 結果画面は、いちばん新しい受験（いま保存した分）を出す
  };
  // 11/17：前は「保存」ボタンがあったが、途中の答えは保存されないのに「保存したよ」と出て紛らわしかったので、
  // 「中断する」1つにまとめた。途中の答えは保存されないことをはっきり伝えて、戻る先を選んでもらう
  const quit = async () => {
    const answered = ans.filter(a => a.trim()).length;
    const v = await ask(`テストを中断しますか。${answered ? `答えた ${answered} 問の答えは保存されません。` : ""}あとで「テスト一覧」の「解き直し」から、もう一度解けます`,
      [{ label: "続ける", value: "no", primary: true }, { label: "テスト一覧へ", value: "list" }, { label: "学習画面へ", value: "study" }]);
    if (v === "list") nav({ s: "G011", ...base }); else if (v === "study") nav({ s: "G004", ...base });
  };
  const set = (v: string) => setAns(ans.map((a, i) => i === idx ? v : a));
  // 11/17：次の問題へ進む方法を分かりやすく（ボタン・Enter キー・1〜4 キー）
  const last = idx === qs.length - 1;
  const next = () => { if (last) void done(); else setIdx(idx + 1); };
  const prev = () => { if (idx > 0) setIdx(idx - 1); };
  keys.current = { next, prev, choose: (n: number) => { if (!kb && choices[n]) set(choices[n]); }, essay };
  return <Shell right={<><div className="col">{qs.map((q, i) => <div key={q.questionId} className={"qn" + (i === idx ? " on" : "")} onClick={() => setIdx(i)}><i />第{i + 1}問{ans[i].trim() ? "　✓" : ""}</div>)}</div><span className="sp" /><button className="btn pri lg" disabled={busy} onClick={done}>{busy ? "保存中…" : "解答"}</button></>}
    center={<>
      <div className="mute">{KIND[test.testType]}{retry ? "（解き直し：解答は新しい回として保存されます）" : ""}　問 {idx + 1} / {qs.length}</div>
      <div className="vbox" style={{ marginTop: 6 }}><h3>第{idx + 1}問</h3><div style={{ fontSize: 17 }}>{qs[idx].questionText}</div>
        {!kb && choices.length > 0 && <div className="choices">{choices.map((c, i) => <button key={i} className={"choice" + (ans[idx] === c ? " on" : "")} onClick={() => set(c)}>選択{i + 1}<br /><small>{c}</small></button>)}</div>}
        {(kb || essay) && <textarea ref={box} className="tx" style={{ minHeight: essay ? 110 : 60, marginTop: 10 }} value={ans[idx]} onChange={e => set(e.target.value)} placeholder="答えを入力" />}
        <div className="qnav"><button className="btn line" disabled={idx === 0} onClick={prev}>← 前の問題</button>
          <span className="sp" />
          <button className={"btn lg " + (last ? "pri" : ans[idx]?.trim() ? "pri" : "")} disabled={busy} onClick={next}>{last ? (busy ? "保存中…" : "解答する") : "次の問題へ →"}</button></div>
        {/* 11/23：説明が3行に折り返していたので、ボタンの下に1行で出す。選択肢の数に合わせて「1〜3」などにする */}
        <div className="mute keyhint">{essay || kb ? (essay ? "Ctrl＋Enter" : "Enter") : `${choices.length > 1 ? `1〜${choices.length}` : "1"} キーで選んで Enter`}で{last ? "解答" : "次の問題へ"}</div></div>
      <div className="bar2"><span className="row"><button className="btn line" onClick={quit}>中断する</button></span>
        {!essay && <button className="btn line" onClick={() => setKb(!kb)}>{kb ? "選択肢にもどす" : "キーボード"}</button>}</div></>} />;
}

/** 直す対象：問題と模範解答／自分の解答／解説 */
type Fix = "question" | "answer" | "expl";

export function TestResult() {
  const { tests, reload, route, go } = useApp();
  const test = tests.find(t => t.testId === route.testId), [idx, setIdx] = useState(0), [msg, setMsg] = useState("");
  const { remaining, refresh } = useAiRemaining();
  // 過去の受験（1回目から順に）と、いま表示している回の受験ID（Controller の G010:getAttempts で読む）
  const [atts, setAtts] = useState<Attempt[]>([]), [attemptId, setAttemptId] = useState("");
  // 直す（G010）：直す対象・書き直し欄・追加の指示
  const [fix, setFix] = useState<Fix | null>(null), [f1, setF1] = useState(""), [f2, setF2] = useState(""), [extra, setExtra] = useState(""), [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(""); // AIを待っている間に出す文（空なら AiWait は出さない）
  const online = useOnline();
  useEffect(() => { // テストが読み直されたら（解答を直したときなど）受験も読み直す。表示している回はそのまま
    if (!test) return;
    void controller.handleRequest("G010", "getAttempts", { testId: test.testId }).then(r => {
      if (!r.data) return;
      const a = r.data as Attempt[]; setAtts(a);
      setAttemptId(cur => a.some(x => x.attemptId === cur) ? cur : (a[a.length - 1]?.attemptId ?? "")); // 最初はいちばん新しい回
    });
  }, [test]);
  if (!test) return <Redirect to={{ s: "G003" }} />;
  const qs = questionsOf(test), q: Question = qs[idx], list = route.mode === "list", base = { subjectId: route.subjectId, itemId: route.itemId };
  const att = atts.find(a => a.attemptId === attemptId) ?? attemptsOf(test).pop(); // 受験の読み込みが終わるまでは、テストに入っている最後の回
  const scored = test.testType === TestType.MEANING_TO_TERM; // 採点するのは「意味→用語」だけ
  const mine = answerOf(att, q.questionId); // この問題への、この回の自分の解答
  const essay = test.testType === TestType.ESSAY, canAnswer = !scored && !!att;
  const useAi = () => { addLocalUsage(1); void refresh(); };
  const expl = async () => {
    if (q.explanation || busy) return; if (remaining !== null && remaining < 1) return setMsg("今日はこれ以上使えません");
    if (!online) return setMsg("インターネットにつながっていません。解説はAIで作るので、つながってから試してください");
    setBusy(true); setWait("AIが解説を書いています");
    const r = await controller.handleRequest("G010", "explain", { testId: test.testId, questionId: q.questionId }); void refresh();
    setBusy(false);
    if (r.error) return setMsg(r.error);
    useAi(); await reload(); setMsg("");
  };
  // 「直す」：対象を選ぶと、いまの内容を書き直し欄に入れる
  const open = (f: Fix) => {
    setFix(f); setMsg(""); setExtra("");
    if (f === "question") { setF1(q.questionText); setF2(q.modelAnswer); } else if (f === "answer") { setF1(mine?.studentAnswer ?? ""); setF2(""); } else { setF1(q.explanation ?? ""); setF2(""); }
  };
  const close = () => { setFix(null); setMsg(""); };
  const saveFix = async () => {
    if (!fix) return; setBusy(true); setWait(""); // 手で直すのはAIを使わないので、待ちの表示は出さない
    const p = { testId: test.testId, questionId: q.questionId };
    const r = fix === "question" ? await controller.handleRequest("G010", "editQuestion", { ...p, question: f1, modelAnswer: f2 })
      : fix === "answer" ? await controller.handleRequest("G010", "editAnswer", { ...p, attemptId: att?.attemptId ?? "", answer: f1 })
      : await controller.handleRequest("G010", "editExplanation", { ...p, explanation: f1 });
    setBusy(false);
    if (r.error) return setMsg(r.error);
    await reload(); // テストが変わるので、上の useEffect が受験も読み直す
    close(); toast("直したよ");
  };
  const aiFix = async () => {
    if (fix !== "question" && fix !== "expl") return;
    if (remaining !== null && remaining < 1) return setMsg("今日はこれ以上使えません");
    if (!online) return setMsg("インターネットにつながっていません。AIで直すのは、つながってから試してください");
    setBusy(true); setWait("AIが直しています");
    const p = { testId: test.testId, questionId: q.questionId, extra };
    const r = fix === "question" ? await controller.handleRequest("G010", "regenerateQuestion", p) : await controller.handleRequest("G010", "regenerateExplanation", p);
    setBusy(false);
    if (r.error) { void refresh(); return setMsg(r.error); }
    useAi(); await reload();
    if (fix === "question") { const nq = r.data as Question; setF1(nq.questionText); setF2(nq.modelAnswer); } else setF1(r.data as string);
    setMsg(""); toast("AIで直して保存したよ");
  };
  const okCount = scored && att ? att.answers.filter(a => a.correct).length : null;
  return <Shell right={<><div className="box" style={{ marginTop: 0 }}><h3>模範解答</h3><div>{att || list ? q.modelAnswer : "（解答するとここに表示されます）"}</div></div>
      <span className="row" style={{ alignSelf: "flex-end" }}><button className="btn line" onClick={() => fix ? close() : open(essay ? "question" : canAnswer ? "answer" : "expl")}>{fix ? "直すのをやめる" : "直す"}</button><button className="btn ai" disabled={busy} onClick={expl}>解説</button></span>
      {q.explanation && <div className="pop" style={{ whiteSpace: "pre-wrap" }}>{q.explanation}</div>}
      {fix && <div className="pop">
        <b>直す内容</b>
        <label className="ck"><input type="radio" checked={fix === "question"} disabled={!essay} onChange={() => open("question")} />問題と模範解答</label>
        <label className="ck"><input type="radio" checked={fix === "answer"} disabled={!canAnswer} onChange={() => open("answer")} />自分の解答{att ? `（第${att.attemptNo}回）` : ""}</label>
        <label className="ck"><input type="radio" checked={fix === "expl"} onChange={() => open("expl")} />解説</label>
        {!essay && <div className="mute">単語テストの問題は、ノートの単語枠で直してください{scored ? "。「意味→用語」は採点があるので、自分の解答は直せません" : ""}</div>}
        {fix === "question" && <><div className="mute">問題</div><textarea className="tx" rows={3} style={{ minHeight: 0, height: "auto" }} value={f1} onChange={e => setF1(e.target.value)} /><div className="mute">模範解答</div><textarea className="tx" rows={3} style={{ minHeight: 0, height: "auto" }} value={f2} onChange={e => setF2(e.target.value)} /></>}
        {fix !== "question" && <textarea className="tx" rows={4} style={{ minHeight: 0, height: "auto" }} value={f1} onChange={e => setF1(e.target.value)} placeholder={fix === "expl" ? "解説を入力" : "解答を入力"} />}
        {fix !== "answer" && <><div className="mute">AIへの追加の指示（空なら最初から作り直す）</div><input className="inp" value={extra} onChange={e => setExtra(e.target.value)} placeholder="例：もっと短く" /></>}
        <span className="row"><button className="btn pri" disabled={busy} onClick={saveFix}>保存</button>{fix !== "answer" && <button className="btn ai" disabled={busy} onClick={aiFix}>{busy ? "作成中…" : "AIで直す"}</button>}</span>
      </div>}
      <AiWait busy={busy && !!wait} what={wait} />
      {msg && <div className="err">{msg}</div>}</>}
    center={<>
      <div className="row"><h2 style={{ margin: 0 }}>結果</h2>{okCount !== null && <b>{okCount} / {qs.length} 問正解</b>}{okCount !== null && qs.length > 0 && <span className="score" role="img" aria-label={`正解率 ${Math.round(okCount / qs.length * 100)}%`}><i style={{ width: `${okCount / qs.length * 100}%` }} /></span>}<span className="mute">{KIND[test.testType]}{att ? `　第${att.attemptNo}回　${fmt(att.takenAt)}` : list ? `　最後に解いた日時 ${fmt(test.lastTakenAt)}` : ""}</span>
        {atts.length > 1 && <select className="inp" style={{ width: "auto", display: "inline-block", margin: 0 }} value={att?.attemptId ?? ""} onChange={e => { setAttemptId(e.target.value); close(); }} aria-label="受験を選ぶ">{atts.map(a => <option key={a.attemptId} value={a.attemptId}>第{a.attemptNo}回（{fmt(a.takenAt)}）</option>)}</select>}</div>
      <div className="qtabs" style={{ marginTop: 8 }}>{qs.map((x, i) => { const r = scored && att ? answerOf(att, x.questionId)?.correct : undefined; return <button key={x.questionId} className={"btn sm" + (i === idx ? " fill" : " line") + (r === true ? " okb" : r === false ? " ngb" : "")} onClick={() => { setIdx(i); close(); }} aria-label={`第${i + 1}問${r === true ? "（正解）" : r === false ? "（不正解）" : ""}`}>第{i + 1}問{r === true ? " ○" : r === false ? " ×" : ""}</button>; })}</div>
      <div className="vbox"><h3>自身の回答</h3><div className="mute">問題</div><div style={{ marginBottom: 8 }}>{q.questionText}</div>
        {att ? <div style={{ whiteSpace: "pre-wrap" }}>{mine?.studentAnswer || "（未回答）"}　{scored && (mine?.correct ? <span className="ok">正解</span> : <span className="ng">不正解</span>)}</div> : <p className="mute">まだ解いていません。「解き直し」で解けます。</p>}</div>
      <div className="bar2"><button className="btn line" onClick={() => go({ s: "G004", ...base })}>終了</button><button className="btn pri" onClick={() => go({ s: "G011", ...base })}>テスト一覧へ戻る</button></div></>} />;
}

export function TestList() {
  const { subjects, items, tests, route, nav } = useApp();
  const [sid, setSid] = useState(route.subjectId ?? subjects[0]?.subjectId), [sel, setSel] = useState<string | null>(null);
  const rows = itemsOf(items, sid).flatMap(i => tests.filter(t => t.itemId === i.itemId).map(t => ({ t, i }))).sort((a, b) => b.t.createdAt.localeCompare(a.t.createdAt));
  const base = (t?: Test) => ({ subjectId: sid, itemId: t?.itemId ?? route.itemId });
  const selected = rows.find(r => r.t.testId === sel)?.t;
  return <Shell center={<>
    <div className="folders">{subjects.map(s => <div key={s.subjectId} className={"folder" + (s.subjectId === sid ? " on" : "")} onClick={() => { setSid(s.subjectId); setSel(null); }}><i />{s.subjectName}</div>)}</div>
    <div className="vbox" style={{ minHeight: 220 }}>{rows.length === 0 && <p className="mute">テストがまだありません。</p>}
      {rows.map(({ t, i }) => <div key={t.testId} className={"trow" + (sel === t.testId ? " on" : "")} onClick={() => setSel(t.testId)}><i className="dot" /><span>{i.itemName}-{ymd(t.createdAt)}</span><span className="mute">{KIND[t.testType]}／{t.questions.length}問／最後に解いた日時 {fmt(t.lastTakenAt)}</span></div>)}</div>
    <div className="bar2"><span className="row"><button className="btn pri" disabled={!sel} onClick={() => nav({ s: "G010", ...base(selected), testId: sel!, mode: "list" })}>結果表示</button>
      <button className="btn" disabled={!sel} onClick={() => nav({ s: "G009", ...base(selected), testId: sel!, mode: "retry" })}>解き直し</button></span>
      <button className="btn line" onClick={() => nav({ s: "G004", subjectId: route.subjectId ?? sid, itemId: route.itemId })}>戻る</button></div></>} />;
}
