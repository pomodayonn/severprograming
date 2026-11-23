// G009 テスト解答：1問ずつ解く。選択肢かキーボードで答え、「解答」→ Controller（G009:submit）が採点して保存
// 11/23：Tests.tsx から分けた（中身は変えていない）
//
// 【共通の流れ】
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useApp } from "../state/app";
import { shuffle } from "../lib/logic";
import { questionsOf } from "../lib/select";
import { controller } from "../controller/Controller";
import { TestType } from "../enums/TestType";
import { Shell } from "./Shell";
import { toast } from "./toast";
import { KIND } from "./testCommon";

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
