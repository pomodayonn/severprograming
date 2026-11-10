// AIの窓口。VITE_API_URL があればサーバー（Render）経由で本物のAIを使い、なければ仮の動きで画面を確かめられる。
// 利用回数（1日20回）はサーバーが数える。仮の動きのときだけ端末で数える（画面側の consumeLocal）。
import { useCallback, useEffect, useState } from "react";
import type { FrameType, Question, Word } from "../types";
import { AI_LIMIT, FT, dayKey } from "../lib/logic";
import { SERVER, request } from "./api";

export { SERVER };
export interface Proposal { id: string; ft: FrameType; text: string; words?: Word[]; targetId?: string }
const pid = () => Math.random().toString(36).slice(2);

// ---------- サーバー版（docs/API.md） ----------
type Remaining = { remaining: number; limit: number };
const server = {
  organize: async (text: string, frameTypes: FrameType[], frames: { id: string; ft?: FrameType }[]) =>
    (await request<{ proposals: Omit<Proposal, "id">[] } & Remaining>("POST", "/api/organize", { text, frameTypes, frames })).proposals.map(p => ({ ...p, id: pid() })),
  makeEssay: async (text: string, count: number) =>
    (await request<{ questions: Question[] } & Remaining>("POST", "/api/essay-test", { text, count })).questions,
  explain: async (q: Question, extra = "") =>
    (await request<{ explanation: string } & Remaining>("POST", "/api/explain", { question: { q: q.q, a: q.a }, extra })).explanation,
  regenerateQuestion: async (q: Question, extra = "") =>
    (await request<{ question: Question } & Remaining>("POST", "/api/regenerate-question", { question: { q: q.q, a: q.a }, extra })).question,
  remaining: async () => (await request<Remaining>("GET", "/api/remaining")).remaining,
};

// ---------- 仮の動き（サーバーがまだないとき） ----------
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const lines = (t: string) => t.split(/\n+/).map(x => x.trim()).filter(x => x.length > 2);
export function classify(x: string): FrameType {
  return /[?？]|求めよ|説明しなさい|答えよ/.test(x) ? "problem" : /[=＝]|公式|定理/.test(x) ? "formula" : /まず|次に|手順|ステップ/.test(x) ? "method" : /答え|解答|よって|したがって/.test(x) ? "answer" : /：|:|とは/.test(x) ? "word" : "summary";
}
const mock = {
  async organize(text: string, types: FrameType[], existing: { id: string; ft?: FrameType }[]): Promise<Proposal[]> {
    await wait(700);
    const by: Partial<Record<FrameType, string[]>> = {};
    lines(text).forEach(l => { const t = classify(l); (by[t] ??= []).push(l); });
    return types.filter(t => by[t]?.length).map(t => {
      const ls = by[t]!, target = existing.find(e => e.ft === t)?.id;
      if (t === "word") return { id: pid(), ft: t, text: "", targetId: target, words: ls.map(l => { const [a, ...b] = l.split(/：|:|とは/); return { term: a.trim(), meaning: (b.join("") || a).trim() }; }) };
      return { id: pid(), ft: t, text: ls.join("\n"), targetId: target };
    });
  },
  async makeEssay(text: string, count: number): Promise<Question[]> {
    await wait(800);
    return lines(text).slice(0, count).map(l => ({ q: `次の内容を、自分の言葉で説明しなさい：「${l.slice(0, 24)}${l.length > 24 ? "…" : ""}」`, a: l }));
  },
  async explain(q: Question, extra = ""): Promise<string> {
    await wait(600);
    return `「${q.a.slice(0, 40)}」がポイントです。問題文の言葉と模範解答を見比べて、どこが違うかを確かめましょう。${extra ? `（指示：${extra}）` : ""}`;
  },
  async regenerateQuestion(q: Question, extra = ""): Promise<Question> {
    await wait(600);
    return { q: `${extra ? `【${extra}】` : ""}次の内容について説明しなさい：「${q.a.slice(0, 24)}」`, a: q.a };
  },
};

// ---------- 画面から呼ぶ関数 ----------
const impl = SERVER ? server : mock;
/** ノートのまとめ：枠の種類ごとの提案 */
export const organize = impl.organize;
/** 記述テストの問題を作る */
export const makeEssay = impl.makeEssay;
/** 解説を作る（extra：作り直すときの追加の指示） */
export const explain = impl.explain;
/** 記述テストの1問を作り直す（W3 のテストを直す機能で使う） */
export const regenerateQuestion = impl.regenerateQuestion;
export const frameLabel = (t: FrameType) => FT[t].n;

/**
 * 今日の残り利用回数。サーバーがあればサーバーに聞き、なければ端末の記録（usage）から数える。
 * remaining が null の間は読み込み中。AIを使った後は refresh() を呼ぶ。
 */
export function useAiRemaining(usage: Record<string, number>) {
  const [srv, setSrv] = useState<number | null>(null);
  const refresh = useCallback(async () => { if (SERVER) { try { setSrv(await server.remaining()); } catch { setSrv(null); } } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const remaining = SERVER ? srv : Math.max(0, AI_LIMIT - (usage[dayKey()] ?? 0));
  return { remaining, limit: AI_LIMIT, refresh };
}
/** 仮の動きのときだけ、端末で利用回数を足す（サーバーがあるときはサーバーが数えるので何もしない） */
export const addLocalUsage = (usage: Record<string, number>, n: number): Record<string, number> =>
  SERVER ? usage : { ...usage, [dayKey()]: (usage[dayKey()] ?? 0) + n };