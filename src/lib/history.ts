// ノートの「元に戻す」「やり直す」の履歴（11/23）
//
// 【このファイルで何が起きているか】
// ノートを変えるたびに、変える前の形を past（過去）に積んでおく。
// 「元に戻す」で past から1つ取り出して戻し、今の形は future（未来）に積む。「やり直す」はその逆。
// 文字を打つ・ドラッグするときは変更が細かく続くので、間が GAP ミリ秒より短い変更は1回分にまとめる。
// 画面やデータベースには関係しない、ただの計算（同じ入力なら必ず同じ答え）

/** 間がこれより短い変更は、1回分にまとめる（ミリ秒） */
export const GAP = 600;
/** 覚えておく回数の上限 */
export const LIMIT = 50;

export interface History<T> { past: T[]; future: T[]; at: number }
export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], at: -Infinity });

/** 変更の前に呼ぶ。cur は変える前の形、time は今の時刻（ミリ秒） */
export function record<T>(h: History<T>, cur: T, time: number): History<T> {
  if (time - h.at < GAP) return { ...h, at: time, future: [] }; // 続けての変更：最初の形だけ覚えておけばよい
  return { past: [...h.past, cur].slice(-LIMIT), future: [], at: time };
}
/** 元に戻す。戻せなければ null */
export function undo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  if (!h.past.length) return null;
  return { h: { past: h.past.slice(0, -1), future: [cur, ...h.future], at: -Infinity }, value: h.past[h.past.length - 1] };
}
/** やり直す。やり直せなければ null */
export function redo<T>(h: History<T>, cur: T): { h: History<T>; value: T } | null {
  if (!h.future.length) return null;
  return { h: { past: [...h.past, cur].slice(-LIMIT), future: h.future.slice(1), at: -Infinity }, value: h.future[0] };
}
