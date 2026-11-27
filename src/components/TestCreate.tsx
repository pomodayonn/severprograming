// G008 テスト作成：範囲・種類・問題数を選んで「作成」→ Controller（G008:createWordTest / createEssayTest）
// 11/23：Tests.tsx から分けた（中身は変えていない）
//
// 【共通の流れ】
// 11/21 道B：テストは beans の Test（questions・attempts）のまま使う。問題は Question、受験は Attempt、解答は Answer。
//   画面が問題ID・受験IDを持っているので、Controller には「何番目の問題か」ではなく問題ID・受験IDを渡す
// どのボタンも Controller → TestManager → TestDAO → 端末に保存（→ Neon）の順に進む
import { useState } from "react";
import { Redirect, useApp } from "../state/app";
import { calls, clampQuestionCount, lengthOf } from "../lib/logic";
import { itemsOf, partsOf } from "../lib/select";
import { addLocalUsage, useAiRemaining } from "../services/ai";
import { controller } from "../controller/Controller";
import type { Test } from "../beans/Test";
import { TestType } from "../enums/TestType";
import { PartType } from "../enums/PartType";
import { AiWait, useOnline } from "./AiWait";
import { Shell } from "./Shell";
import { toast } from "./toast";
import { KIND, KINDS } from "./testCommon";

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
      const c = calls(send);

    // 分割した文章すべてから出題できることを確認する。
    if (c > n) {
      return setMsg("送る内容が多すぎます。問題数を増やすか、送る内容を減らしてください");
    }

    if (remaining !== null && c > remaining) {
      return setMsg(`AIの利用回数が足りません（必要：${c}回）`);
    }
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
          {essay && <div className="mute">送る内容：{send ? `${lengthOf(send).toLocaleString()}文字を決定済み` : "まだ決めていません"}<br />今日の残り利用回数：{limit} 回中 {remaining ?? "…"} 回</div>}</div></div>
      <AiWait busy={busy && essay} what="AIが問題を作っています" />
      {msg && <div className="err">{msg}</div>}</div>
    <div className="bar2"><span className="row"><button className={"btn lg " + (essay ? "ai" : "pri")} disabled={busy || (essay && !online)} onClick={make}>{busy ? "作成中…" : "作成"}</button>
      <button className="btn line" disabled={!essay} onClick={() => { setTmp({ g8: { itemId: item.itemId, scope, picks, kind, count } satisfies G8Choice }); void go({ s: "G007", subjectId: subject.subjectId, itemId: item.itemId, purpose: "essay" }); }}>内容編集</button></span>
      <button className="btn line" onClick={() => go({ s: "G004", subjectId: subject.subjectId, itemId: item.itemId })}>戻る</button></div></>} />;
}

/** テスト作成画面（G008）で選んだもの。G007 に行って戻ったときに元に戻すために tmp.g8 に置く */
interface G8Choice { itemId: string; scope: "all" | "pick"; picks: string[]; kind: TestType; count: number }
