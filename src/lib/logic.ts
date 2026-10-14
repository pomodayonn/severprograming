// 純粋ロジック（画面に依存しない）。テストしやすいようにここへ集める。
import type { Item, Subject, QA } from "../types";

export const DAY = 864e5;
export const LV = ["未学習", "要復習", "定着中", "定着"];
/** 枠（ブロック）。lv = 要約の度合い（0=原文のまま 1=要点 2=最短） */
export const BLK: Record<string, { n: string; lv: number }> = {
  q: { n: "問題", lv: 1 }, f: { n: "公式", lv: 0 }, a: { n: "解答", lv: 1 }, s: { n: "解き方", lv: 2 }, m: { n: "要約", lv: 2 },
};
export const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export const toHtml = (t: string) => esc(t).replace(/\n/g, "<br>");
export const blkHtml = (k: string, body = "") =>
  `<div class="blk blk-${k}" data-k="${k}"><span class="bl" contenteditable="false">${BLK[k].n}</span><div class="bb">${body || "<br>"}</div></div><p><br></p>`;

/** 記憶の残り具合の目安 0〜1（-1は未学習） */
export function ret(it: Item): number {
  if (!it.history.length) return -1;
  const t = [...it.history].reverse().find(h => h.kind === "test");
  if (!t || t.score == null) return .15;
  return (t.score / 5) * Math.exp(-((Date.now() - t.at) / DAY) / (2 + t.score * 3));
}
/** 復習度 0:未学習 1:要復習 2:定着中 3:定着 */
export function level(it: Item): number {
  if (!it.history.length) return 0;
  const t = [...it.history].reverse().find(h => h.kind === "test");
  if (!t || t.score == null) return 1;
  const d = (Date.now() - t.at) / DAY;
  if (t.score >= 4 && d < 7) return 3;
  if (t.score >= 3 && d < 14) return 2;
  return 1;
}
export const hue = (it: Item) => { const r = ret(it); return r < 0 ? "var(--l0)" : `hsl(${Math.round(28 + r * 135)} 62% ${Math.round(48 - r * 6)}%)`; };
export const greet = () => { const h = new Date().getHours(); return h < 5 ? "夜ふかしだね" : h < 11 ? "おはよう" : h < 18 ? "こんにちは" : "おつかれさま"; };

export function reviewTodo(subjects: Subject[]) {
  const order = [1, 0, 2, 3];
  return subjects.flatMap(s => s.items.map(i => ({ s, i, l: level(i) }))).filter(x => x.l < 3).sort((a, b) => order.indexOf(a.l) - order.indexOf(b.l));
}

export const sents = (t: string) => t.split(/[。\n]/).map(x => x.trim()).filter(x => x.length > 4);
export const classify = (x: string) =>
  /[?？]|求めよ|答えよ|説明し|とは/.test(x) ? "q" : /[=＝]|公式|定理|定義/.test(x) ? "f" : /まず|次に|ステップ|手順|①|②/.test(x) ? "s" : /答え|解答|したがって|よって|ゆえに/.test(x) ? "a" : "m";
export const squeeze = (k: string, t: string) => { const lv = BLK[k].lv, a = sents(t); return lv === 0 || a.length <= 1 ? t : a.slice(0, lv === 1 ? 2 : 1).join("。") + "。"; };

export function blocksOf(it: Item): { k: string; text: string }[] {
  const d = new DOMParser().parseFromString(it.noteHtml ?? "", "text/html");
  return Array.from(d.querySelectorAll<HTMLElement>(".blk")).map(b => ({ k: b.dataset.k ?? "m", text: (b.querySelector(".bb")?.textContent ?? "").trim() })).filter(x => x.text);
}
/** 「問題」の枠 → 直後の「解答／解き方」の枠を模範解答にする */
export function qaOf(it: Item): QA[] {
  const bs = blocksOf(it), out: QA[] = [];
  bs.forEach((b, n) => {
    if (b.k !== "q") return;
    const ans: string[] = [];
    for (let j = n + 1; j < bs.length && bs[j].k !== "q"; j++) if (bs[j].k === "a" || bs[j].k === "s") ans.push(bs[j].text);
    out.push({ q: b.text, a: ans.join("\n") || "（まだ解答の枠がないよ）" });
  });
  return out;
}
/** カーソル位置のしるし(#cmark)があればそこへ、なければ末尾へ挿入 */
export function placeHtml(it: Item, html: string): Pick<Item, "noteHtml" | "note"> {
  const h = it.noteHtml ?? toHtml(it.note), mk = /<span id="cmark"><\/span>/;
  const noteHtml = mk.test(h) ? h.replace(mk, html) : h + html;
  return { noteHtml, note: new DOMParser().parseFromString(noteHtml, "text/html").body.textContent ?? "" };
}
