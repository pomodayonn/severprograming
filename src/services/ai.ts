// AIの差し替え口。実装時は fetch("/api/...") 版に置き換える（サーバー経由で複数のAIサービスを順に試す）。
import type { FrameType, Question, Word } from "../types";
import { FT } from "../lib/logic";

export interface Proposal { id: string; ft: FrameType; text: string; words?: Word[]; targetId?: string }
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const lines = (t: string) => t.split(/\n+/).map(x => x.trim()).filter(x => x.length > 2);
export function classify(x: string): FrameType {
  return /[?？]|求めよ|説明しなさい|答えよ/.test(x) ? "problem" : /[=＝]|公式|定理/.test(x) ? "formula" : /まず|次に|手順|ステップ/.test(x) ? "method" : /答え|解答|よって|したがって/.test(x) ? "answer" : /：|:|とは/.test(x) ? "word" : "summary";
}
/** ノートのまとめ（仮実装：行の言葉づかいで枠に振り分けるだけ） */
export async function organize(text: string, types: FrameType[], existing: { id: string; ft?: FrameType }[]): Promise<Proposal[]> {
  await wait(700);
  const by: Partial<Record<FrameType, string[]>> = {};
  lines(text).forEach(l => { const t = classify(l); (by[t] ??= []).push(l); });
  return types.filter(t => by[t]?.length).map(t => {
    const ls = by[t]!, target = existing.find(e => e.ft === t)?.id;
    if (t === "word") return { id: Math.random().toString(36).slice(2), ft: t, text: "", targetId: target, words: ls.map(l => { const [a, ...b] = l.split(/：|:|とは/); return { term: a.trim(), meaning: (b.join("") || a).trim() }; }) };
    return { id: Math.random().toString(36).slice(2), ft: t, text: ls.join("\n"), targetId: target };
  });
}
export async function makeEssay(text: string, count: number): Promise<Question[]> {
  await wait(800);
  return lines(text).slice(0, count).map(l => ({ q: `次の内容を、自分の言葉で説明しなさい：「${l.slice(0, 24)}${l.length > 24 ? "…" : ""}」`, a: l }));
}
export async function explain(q: Question): Promise<string> {
  await wait(600);
  return `「${q.a.slice(0, 40)}」がポイントです。問題文の言葉と模範解答を見比べて、どこが違うかを確かめましょう。`;
}
export const frameLabel = (t: FrameType) => FT[t].n;
