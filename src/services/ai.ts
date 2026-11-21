// AIの窓口。VITE_API_URL があればサーバー（Render）経由で本物のAIを使い、なければ仮の動きで画面を確かめられる。
// 利用回数（1日20回）はサーバーが数える。仮の動きのときだけ端末で数える（画面側の consumeLocal）。
//
// 【このファイルで何が起きているか】
// AIに「まとめて」「問題を作って」「解説して」と頼む窓口です。中身が2通りあります。
// ・server：VITE_API_URL があるとき。services/api.ts を通して福山さんのサーバーに送り、サーバーが Groq に聞く
// ・mock  ：サーバーがまだないとき。AIを使わず、決まった作り方で「それっぽい答え」を返す（画面の確認用）
// 下の impl = SERVER ? server : mock で、どちらを使うかが決まる。使う側（Manager）はどちらか気にしなくてよい
import { useCallback, useEffect, useState } from "react";
import type { FrameType } from "../types";
import { AI_LIMIT, dayKey, newId } from "../lib/logic";
import { SERVER, request } from "./api";
import { lineToWord, type TermMeaning } from "../lib/words";

export { SERVER };
/** AIのサーバーとやり取りする形（AiSummaryManager が beans の Suggestion にする。画面はこの形を見ない） */
export interface Proposal { id: string; ft: FrameType; text: string; words?: TermMeaning[]; targetId?: string }
/** AIのサーバーとやり取りする問題の形（TestManager が beans の Question にする） */
export interface QA { q: string; a: string }

// ---------- サーバー版（docs/API.md） ----------
type Remaining = { remaining: number; limit: number };
const server = {
  organize: async (text: string, frameTypes: FrameType[], frames: { id: string; ft?: FrameType }[]) =>
    (await request<{ proposals: Omit<Proposal, "id">[] } & Remaining>("POST", "/api/organize", { text, frameTypes, frames })).proposals.map(p => ({ ...p, id: newId() })),
  makeEssay: async (text: string, count: number) =>
    (await request<{ questions: QA[] } & Remaining>("POST", "/api/essay-test", { text, count })).questions,
  explain: async (q: QA, extra = "") =>
    (await request<{ explanation: string } & Remaining>("POST", "/api/explain", { question: { q: q.q, a: q.a }, extra })).explanation,
  regenerateQuestion: async (q: QA, extra = "") =>
    (await request<{ question: QA } & Remaining>("POST", "/api/regenerate-question", { question: { q: q.q, a: q.a }, extra })).question,
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
      if (t === "word") return { id: newId(), ft: t, text: "", targetId: target, words: ls.map(lineToWord) };
      return { id: newId(), ft: t, text: ls.join("\n"), targetId: target };
    });
  },
  async makeEssay(text: string, count: number): Promise<QA[]> {
    await wait(800);
    return lines(text).slice(0, count).map(l => ({ q: `次の内容を、自分の言葉で説明しなさい：「${l.slice(0, 24)}${l.length > 24 ? "…" : ""}」`, a: l }));
  },
  async explain(q: QA, extra = ""): Promise<string> {
    await wait(600);
    return `「${q.a.slice(0, 40)}」がポイントです。問題文の言葉と模範解答を見比べて、どこが違うかを確かめましょう。${extra ? `（指示：${extra}）` : ""}`;
  },
  async regenerateQuestion(q: QA, extra = ""): Promise<QA> {
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

/**
 * 今日の残り利用回数。サーバーがあればサーバーに聞き、なければ端末の記録から数える。
 * remaining が null の間は読み込み中。AIを使った後は refresh() を呼ぶ。
 * 11/21：前は画面から data.usage を渡していたが、端末の記録はこのファイルの中だけで持つようにした（画面は data を見ない）
 */
export function useAiRemaining() {
  const [srv, setSrv] = useState<number | null>(null), [used, setUsed] = useState(localUsed);
  const refresh = useCallback(async () => { if (SERVER) { try { setSrv(await server.remaining()); } catch { setSrv(null); } } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const on = () => setUsed(localUsed()); listeners.add(on); return () => { listeners.delete(on); }; }, []);
  const remaining = SERVER ? srv : Math.max(0, AI_LIMIT - used);
  return { remaining, limit: AI_LIMIT, refresh };
}

/** 今日の残り利用回数をサーバーに聞く（Manager から使う）。サーバーがないときは null（分からない） */
export async function fetchRemaining(): Promise<number | null> {
  if (!SERVER) return null;
  try { return await server.remaining(); } catch { return null; }
}

// ---- 仮の動き（サーバーがないとき）の利用回数：端末に「日付→回数」で記録する ----
const USAGE_KEY = "runndesu-ai-usage";
const listeners = new Set<() => void>();
function localUsed(): number {
  try { return (JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}") as Record<string, number>)[dayKey()] ?? 0; } catch { return 0; }
}
/** 仮の動きのときだけ、端末で利用回数を足す（サーバーがあるときはサーバーが数えるので何もしない） */
export function addLocalUsage(n: number): void {
  if (SERVER) return;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ [dayKey()]: localUsed() + n })); } catch { /* 保存できなくても続ける */ }
  listeners.forEach(f => f());
}
