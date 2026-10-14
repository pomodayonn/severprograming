// AIの差し替え口。実装時は fetch("/api/...") 版に置き換えるだけ（画像も渡せる形）。
import type { QA } from "../types";
import { classify, sents, squeeze } from "../lib/logic";

export interface AIInput { title: string; text: string; images: string[] }
export interface AIProvider {
  summarize(i: AIInput): Promise<string>;
  questions(i: AIInput): Promise<QA[]>;
  organize(i: AIInput): Promise<{ k: string; text: string }[]>;
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 仮実装：資料の文から機械的に作るだけ */
export const mockAI: AIProvider = {
  async summarize({ title, text }) { await wait(700); const a = sents(text).slice(0, 4); return a.length ? `【${title}の要約】\n` + a.map(x => "・" + x).join("\n") : ""; },
  async questions({ title, text }) { await wait(700); return sents(text).slice(0, 5).map(x => ({ q: `${title}について、次の内容を説明してください：${x.slice(0, Math.ceil(x.length / 2))}…`, a: x })); },
  async organize({ text }) { await wait(600); return text.split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => { const k = classify(x); return { k, text: squeeze(k, x) }; }); },
};
export const ai: AIProvider = mockAI;
