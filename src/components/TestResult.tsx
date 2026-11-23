// G010 テスト結果：結果を見る。「解説」でAIの解説、「直す」で問題・自分の解答・解説を書き直す。過去の回も選べる
// 11/23：Tests.tsx から分けた（中身は変えていない）
//
// 【共通の流れ】
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useEffect, useState } from "react";
import { Redirect, useApp } from "../state/app";
import { fmt } from "../lib/logic";
import { answerOf, attemptsOf, questionsOf } from "../lib/select";
import { addLocalUsage, useAiRemaining } from "../services/ai";
import { controller } from "../controller/Controller";
import type { Question } from "../beans/Question";
import type { Attempt } from "../beans/Attempt";
import { TestType } from "../enums/TestType";
import { AiWait, useOnline } from "./AiWait";
import { Shell } from "./Shell";
import { toast } from "./toast";
import { KIND } from "./testCommon";

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
        {fix === "question" && <><div className="mute">問題</div><textarea className="tx fit" rows={3} value={f1} onChange={e => setF1(e.target.value)} /><div className="mute">模範解答</div><textarea className="tx fit" rows={3} value={f2} onChange={e => setF2(e.target.value)} /></>}
        {fix !== "question" && <textarea className="tx fit" rows={4} value={f1} onChange={e => setF1(e.target.value)} placeholder={fix === "expl" ? "解説を入力" : "解答を入力"} />}
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
