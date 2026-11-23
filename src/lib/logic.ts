// 純粋ロジック（画面に依存しない）
// 【このファイルで何が起きているか】
// 画面にもデータベースにも関係しない、小さな計算をまとめたファイルです（入力が同じなら答えも必ず同じ）。
// 例：枠の色と名前（FT）、IDを作る（newId）、日時の表示（fmt）、送る回数の計算（calls）、新しい部品を作る（newPart）
// 11/21 リファクタリング：使っていなかった wordsOf・wordTest・wouldCycle を消し、
//   あちこちに同じものが書いてあった newId・shuffle・isCorrect・問題数・「元→先」の置き換えをここにまとめた
import type { FrameType } from "../types";
import { NotePart } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { now, type DateTime } from "../beans/DateTime";
import { PartType } from "../enums/PartType";
export const AI_LIMIT = 20, SEND_LIMIT = 10000, MAX_FILE = 20 * 1024 * 1024;
export const FT: Record<FrameType, { n: string; c: string }> = {
  word: { n: "単語枠", c: "#2e7d6d" }, problem: { n: "問題枠", c: "#cf3f5b" }, formula: { n: "公式枠", c: "#3b7fb5" },
  answer: { n: "解答枠", c: "#7a5fb0" }, method: { n: "解き方枠", c: "#d98a1f" }, summary: { n: "要約枠", c: "#5a5670" },
};
/** 新しいID（科目・学習項目・ノート・部品・テストなど、すべてこれで作る。ランダムな文字＋時刻なので、ほぼかぶらない） */
export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** 日時の表示（例：11/21 21:13）。beans の日時（ISO の文字列）でも、数（ミリ秒）でもよい。なければ「－」 */
export const fmt = (t?: DateTime | number | null) => t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "－";
/** 単語テストの採点：全角半角・大文字小文字・前後の空白は区別せず、全体一致だけ正解 */
export const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const isCorrect = (user: string, model: string) => !!user.trim() && norm(user) === norm(model);
export function shuffle<T>(a: T[]): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
/** 問題数を5〜20問にそろえる（数でなければ10問） */
export const clampQuestionCount = (n: number) => Math.min(20, Math.max(5, Math.round(n) || 10));
export const calls = (chars: number) => Math.max(1, Math.ceil(chars / SEND_LIMIT));
export const chunkText = (t: string, size = 1200) => { const out: string[] = []; for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size)); return out.length ? out : [""]; };
export function txtName(base: string, existing: string[]) { let n = `${base}.txt`, k = 2; while (existing.includes(n)) n = `${base}(${k++}).txt`; return n; }
/** 「元の文字→直した文字」の指示を読む（「->」でもよい）。形が違えば null */
export function parseReplace(ins: string): { from: string; to: string } | null {
  const [a, ...b] = ins.split(/→|->/);
  if (!a.trim() || !b.length) return null;
  return { from: a.trim(), to: b.join("→").trim() };
}
/** parseReplace で読んだ指示どおりに、文字をすべて置き換える */
export const replaceText = (s: string, r: { from: string; to: string }) => s.split(r.from).join(r.to);
/** 新しい単語（単語枠の1行）。partId は入れる部品のID */
export const newWord = (partId: string): Word => new Word({ wordId: newId(), partId, term: "", meaning: "", updatedAt: now() });
/** ノートに置く新しい部品（枠・文字・図形・矢印）。y の高さに置く。ft は枠の種類（枠のときだけ） */
export function newPart(type: PartType, y: number, ft?: FrameType): NotePart {
  const partId = newId();
  const size = { [PartType.FRAME]: [380, ft === "word" ? 150 : 110], [PartType.TEXT]: [360, 44], [PartType.SHAPE]: [90, 90], [PartType.ARROW]: [160, 30] }[type];
  return new NotePart({
    partId, partType: type, frameType: type === PartType.FRAME ? (ft ?? "summary") : null, x: 24, y, width: size[0], height: size[1],
    color: ft ? FT[ft].c : "#d98a1f", text: type === PartType.SHAPE ? "rect" : "", headingLevel: 0, updatedAt: now(),
    words: ft === "word" ? [newWord(partId)] : [],
  });
}
/** 部品のいちばん下より少し下（新しい部品を置く高さ） */
export const bottomY = (parts: readonly NotePart[]) => parts.reduce((m, p) => Math.max(m, p.y + p.height), 0) + 36;
/** 関連図の丸の中に書く名前。4文字までは1行、5文字以上は4文字ずつ2行に分け、2行に入らない分は「…」にする（11/23） */
export function nodeLabel(name: string): string[] {
  const c = [...name];
  if (c.length <= 4) return [name];
  const rest = c.slice(4);
  return [c.slice(0, 4).join(""), rest.length > 4 ? rest.slice(0, 3).join("") + "…" : rest.join("")];
}
