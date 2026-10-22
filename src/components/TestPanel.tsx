import { useState } from "react";
import type { Item } from "../types";
import { useStore } from "../state/store";
import { qaOf } from "../lib/logic";
import { toast } from "./toast";

export function TestPanel({ sid, it }: { sid: string; it: Item }) {
  const { dispatch } = useStore();
  const qs = it.questions.length ? it.questions : qaOf(it);
  const [qi, setQi] = useState(0); const [draft, setDraft] = useState("");
  const [hint, setHint] = useState(false); const [reveal, setReveal] = useState(false); const [rate, setRate] = useState(0);
  const cq = qs[qi];
  const pick = (k: number) => { setQi(k); setReveal(false); setDraft(""); };
  return (<>
    {qs.length > 0 && <div className="qs">{qs.map((_, k) => <button key={k} className={k === qi ? "on" : ""} onClick={() => pick(k)}>問{k + 1}</button>)}</div>}
    <p className="q">{cq ? cq.q : `「${it.title}」を、何も見ずに説明してみよう。`}</p>
    <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="試験で答えるつもりで書いてみよう" />
    {hint && <div className="hint">{it.note || "まとめノートはまだありません"}</div>}
    {reveal && cq && <div className="hint ans">模範解答：{cq.a}</div>}
    <div className="ops">
      <button onClick={() => setHint(!hint)}>{hint ? "ノートを隠す" : "ノートを見る"}</button>
      {cq && <button onClick={() => setReveal(!reveal)}>{reveal ? "答えを隠す" : "答えを見る"}</button>}
      <span className="rate">自己評価{[1, 2, 3, 4, 5].map(n => <button key={n} className={rate === n ? "sel" : ""} onClick={() => setRate(n)}>{n}</button>)}</span>
      <button className="pri" disabled={!rate} onClick={() => { dispatch({ t: "attempt", s: sid, i: it.id, a: { at: Date.now(), kind: "test", score: rate, text: draft } }); setRate(0); setHint(false); setDraft(""); toast("履歴に保存したよ"); }}>履歴に保存</button>
    </div>
  </>);
}
