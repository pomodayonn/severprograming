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
/** 名前（科目名・学習項目名）の長さの上限 */
export const NAME_MAX = 50;
/**
 * 名前の確認（11/23：画面のポップアップと Manager の checkName で同じルールを使うため、ここにまとめた）。
 * 前後の空白を取って1〜50文字ならエラーなし（null）。文字数は絵文字も1文字と数える（[...n].length）
 */
export function nameError(name: string, label: string): string | null {
  const n = name.trim();
  if (!n) return `${label}を入力してください`;
  if ([...n].length > NAME_MAX) return `${label}は${NAME_MAX}文字までです`;
  return null;
}
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
    // 11/25 夕：矢印は、左から右へ 140px の矢印として置く（点の位置を text に入れる。arrowFromPoints を参照）
    ...(type === PartType.ARROW ? arrowFromPoints(24 + ARROW_PAD, y + ARROW_PAD + ARROW_TOP, 164 + ARROW_PAD, y + ARROW_PAD + ARROW_TOP) : {}),
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
/** テスト名に使う日付（例：20261121）。11/23：Tests.tsx から移した */
export const ymd = (t: string) => { const d = new Date(t); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };
/** ノートに要る幅：いちばん右の部品の右はし ＋ 余白24px（11/23）。これがノートの見える幅より大きいと、横にはみ出している */
export function canvasWidth(parts: readonly { x: number; width: number }[]): number {
  let w = 0; for (const p of parts) w = Math.max(w, p.x + p.width);
  return w + 24;
}
/** アカウントから受け取ったデータを、受け取り直さずに使う長さ（30分）。11/23 */
export const PULL_MAX_AGE_MS = 30 * 60 * 1000;
/**
 * 受け取り直したほうがよいか（11/23）。前回受け取った時刻 lastPulledAt から maxAge 以上たっていれば true。
 * まだ受け取ったことがない（null）・時刻が読めない・端末の時計が戻って未来の時刻になっている、ときも true（念のため受け取る）
 */
export function isPullStale(lastPulledAt: string | null | undefined, nowMs: number, maxAge = PULL_MAX_AGE_MS): boolean {
  if (!lastPulledAt) return true;
  const t = Date.parse(lastPulledAt);
  if (Number.isNaN(t) || t > nowMs) return true;
  return nowMs - t >= maxAge;
}
/** ノートの拡大・縮小の段階（11/25）。「−」「＋」で1段ずつ動く */
export const ZOOMS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
/** 今の倍率 z から、dir（+1 で大きく、-1 で小さく）に1段動かした倍率。「全体を表示」などで段階の間にいても、近い次の段へ進む */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find(v => v > z + 0.001) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find(v => v < z - 0.001) ?? ZOOMS[0];
}
/** 左右の欄の幅（11/25）。ドラッグで変えられるのは 180〜480px */
export const PANE_MIN = 180, PANE_MAX = 480;
export const clampPane = (w: number) => Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, w)));
/** 部品の複製（11/25）：IDを新しくして、右下に24pxずらす。単語枠の単語も、新しいIDで複製する */
export function copyPart(p: NotePart, dx = 24, dy = 24): NotePart {
  const partId = newId();
  return new NotePart({ ...p, partId, x: p.x + dx, y: p.y + dy, updatedAt: now(), words: p.words.map(w => new Word({ ...w, wordId: newId(), partId, updatedAt: now() })) });
}
/** 部品の重なり順を変える（11/25）。あとの部品ほど上（前）に描かれるので、前面へは最後に、背面へは最初に動かす */
export function moveLayer(parts: readonly NotePart[], partId: string, to: "front" | "back"): NotePart[] {
  const p = parts.find(x => x.partId === partId); if (!p) return [...parts];
  const rest = parts.filter(x => x.partId !== partId);
  return to === "front" ? [...rest, p] : [p, ...rest];
}
// ---- 矢印の向き（11/25 夕）----
// 矢印は「始まりの点」と「先の点」を自由に動かせる。2つの点は、部品の左上からの位置（px）で text に "arrow:x1,y1,x2,y2" と入れる
// （矢印は文字を持たないので、図形の形と同じく text を使う。Neon の列は増やさない）。text が空の古い矢印は、今までどおり左から右へ
/** 矢印の点のまわりの余白と、上の帯（色・× のボタン）の高さ */
export const ARROW_PAD = 14, ARROW_TOP = 24;
export interface ArrowPts { x1: number; y1: number; x2: number; y2: number }
/** 矢印の2つの点（部品の左上から）。読めなければ今までの形（左から右、まん中の高さ） */
export function arrowPoints(p: { width: number; height: number; text: string }): ArrowPts {
  const m = p.text.match(/^arrow:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/);
  if (m) return { x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
  const y = ARROW_TOP + (p.height - ARROW_TOP) / 2;
  return { x1: 4, y1: y, x2: p.width - 2, y2: y };
}
/** ノートの上の2つの点（a が始まり、b が先）から、矢印の部品の位置・大きさ・text を作る。ノートの外（左・上）には出さない */
export function arrowFromPoints(ax: number, ay: number, bx: number, by: number) {
  ax = Math.max(ARROW_PAD, ax); bx = Math.max(ARROW_PAD, bx); ay = Math.max(ARROW_PAD + ARROW_TOP, ay); by = Math.max(ARROW_PAD + ARROW_TOP, by);
  const x = Math.min(ax, bx) - ARROW_PAD, y = Math.min(ay, by) - ARROW_PAD - ARROW_TOP;
  const width = Math.max(60, Math.max(ax, bx) + ARROW_PAD - x), height = Math.max(ARROW_TOP + 30, Math.max(ay, by) + ARROW_PAD - y);
  const r = (n: number) => Math.round(n);
  return { x: r(x), y: r(y), width: r(width), height: r(height), text: `arrow:${r(ax - x)},${r(ay - y)},${r(bx - x)},${r(by - y)}` };
}

