// 純粋ロジック（画面に依存しない）
import type { El, FrameType, Item, Question, TestKind, Word } from "../types";
export const AI_LIMIT = 20, SEND_LIMIT = 10000, MAX_FILE = 20 * 1024 * 1024;
export const FT: Record<FrameType, { n: string; c: string }> = {
  word: { n: "単語枠", c: "#2e7d6d" }, problem: { n: "問題枠", c: "#cf3f5b" }, formula: { n: "公式枠", c: "#3b7fb5" },
  answer: { n: "解答枠", c: "#7a5fb0" }, method: { n: "解き方枠", c: "#d98a1f" }, summary: { n: "要約枠", c: "#5a5670" },
};
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export const fmt = (t?: number) => t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "－";
/** 単語テストの採点：全角半角・大文字小文字・前後の空白は区別せず、全体一致だけ正解 */
export const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const isCorrect = (user: string, model: string) => !!user.trim() && norm(user) === norm(model);
export const passwordOk = (p: string) => p.length >= 8 && p.length <= 16 && /[A-Za-z]/.test(p) && /\d/.test(p);
export const loginIdOk = (v: string) => /^[A-Za-z0-9_-]{8,16}$/.test(v);
export const wordsOf = (els: El[]): Word[] => els.filter(e => e.kind === "frame" && e.ft === "word").flatMap(e => e.words ?? []).filter(w => w.term.trim() && w.meaning.trim());
export function shuffle<T>(a: T[]): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
export function wordTest(words: Word[], kind: TestKind, count: number): Question[] {
  return shuffle(words).slice(0, count).map(w => kind === "w-m2t" ? { q: w.meaning, a: w.term } : { q: w.term, a: w.meaning });
}
export const calls = (chars: number) => Math.max(1, Math.ceil(chars / SEND_LIMIT));
export const chunkText = (t: string, size = 1200) => { const out: string[] = []; for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size)); return out.length ? out : [""]; };
export function txtName(base: string, existing: string[]) { let n = `${base}.txt`, k = 2; while (existing.includes(n)) n = `${base}(${k++}).txt`; return n; }
/** 前提項目が輪になるか（itemId の前提に pre を足すと、pre から itemId にたどり着くか） */
export function wouldCycle(items: Item[], itemId: string, pre: string): boolean {
  const seen = new Set<string>(); const go = (id: string): boolean => { if (id === itemId) return true; if (seen.has(id)) return false; seen.add(id); return (items.find(i => i.id === id)?.prereqs ?? []).some(go); };
  return go(pre);
}
export const newEl = (kind: El["kind"], y: number, ft?: FrameType): El => ({
  id: uid(), kind, ft, x: 24, y, at: Date.now(), color: ft ? FT[ft].c : "#d98a1f", text: "",
  w: kind === "arrow" ? 160 : kind === "shape" ? 90 : kind === "text" ? 360 : 380, h: kind === "arrow" ? 30 : kind === "shape" ? 90 : kind === "text" ? 44 : ft === "word" ? 150 : 110,
  words: ft === "word" ? [{ term: "", meaning: "" }] : undefined, head: 0, shape: "rect",
});
export const bottomY = (els: El[]) => els.reduce((m, e) => Math.max(m, e.y + e.h), 0) + 36;
