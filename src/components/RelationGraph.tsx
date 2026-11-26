// 関連図：学習項目を丸、前提のつながりを線で表す。丸を押すとその項目のノートに切り替える
// ノートを書いている間（items が同じ間）は配置を計算し直さず、描き直しもしない。
//
// 【このファイルで何が起きているか】
// 右側の関連図です。学習項目を丸、前提のつながりを線で描く。
// layout が「前提が何段あるか」を数えて、前提のない項目を左に、あとで学ぶ項目ほど右に並べる。
// 丸を押すと、その学習項目のノートに移る
// 11/26：開いている項目を目立たせ、その項目につながる線に色を付けた（前に学ぶ項目からの線は赤、次に学ぶ項目への線は緑）。
//   ほかの線は薄くする。線の色の見方は Study.tsx の関連図の下に出す
import { memo, useMemo } from "react";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import { prereqIdsOf } from "../lib/select";
import { nodeLabel } from "../lib/logic";

/** 丸の半径と、丸どうしの横・縦の間隔（11/23：名前が読めるように大きくした） */
const R = 36, GX = 118, GY = 96;
/** 線の色：ふつう・前に学ぶ項目から（赤）・次に学ぶ項目へ（緑）・開いている項目と関係ない線（薄い） */
const EDGE = { base: "#cdbfa8", in: "#cf3f5b", out: "#2f7d6d", dim: "#e6ddce" } as const;
type EdgeKind = keyof typeof EDGE;

function layout(items: LearningItem[], prerequisites: readonly Prerequisite[]) {
  const byId = new Map(items.map(i => [i.itemId, i])), depth = new Map<string, number>();
  const d = (id: string, seen: Set<string>): number => { // 前提の段数（輪になっていても止まる）
    const cached = depth.get(id); if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; seen.add(id);
    const pre = prereqIdsOf(prerequisites, id).filter(p => byId.has(p));
    const v = pre.length ? 1 + Math.max(...pre.map(p => d(p, seen))) : 0;
    seen.delete(id); depth.set(id, v); return v;
  };
  const cols = new Map<number, string[]>();
  for (const i of items) { const c = d(i.itemId, new Set()); (cols.get(c) ?? cols.set(c, []).get(c)!).push(i.itemId); }
  const pos = new Map<string, [number, number]>();
  let rows = 0;
  cols.forEach((ids, c) => { rows = Math.max(rows, ids.length); ids.forEach((id, r) => pos.set(id, [R + 12 + c * GX, R + 12 + r * GY])); });
  return { pos, W: 2 * R + 24 + (cols.size - 1) * GX, H: 2 * R + 24 + (rows - 1) * GY };
}

/** items はその科目の学習項目、prerequisites は前提項目（ほかの科目の分が入っていてもよい） */
interface Props { items: LearningItem[]; prerequisites: readonly Prerequisite[]; selId?: string; onOpen: (id: string) => void }
function Graph({ items, prerequisites, selId, onOpen }: Props) {
  const g = useMemo(() => layout(items, prerequisites), [items, prerequisites]);
  if (!items.length) return <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ろう。</p>;
  const at = (id: string) => g.pos.get(id)!;
  const has = !!selId && g.pos.has(selId);
  /** 線の種類：開いている項目に入る線（前に学ぶ項目から）・出る線（次に学ぶ項目へ）・それ以外 */
  const kind = (p: string, i: string): EdgeKind => !has ? "base" : i === selId ? "in" : p === selId ? "out" : "dim";
  const rank = (k: EdgeKind) => (k === "dim" || k === "base" ? 0 : 1);
  const edges = items.flatMap(i => prereqIdsOf(prerequisites, i.itemId).filter(p => g.pos.has(p)).map(p => ({ p, i: i.itemId, k: kind(p, i.itemId) })));
  /** 開いている項目とつながっている項目（丸をうすく色付けする） */
  const near = new Set(edges.filter(e => e.k === "in" || e.k === "out").map(e => (e.k === "in" ? e.p : e.i)));
  return (
    <svg viewBox={`0 0 ${g.W} ${g.H}`} style={{ maxWidth: g.W * 1.15 }} className="graph" role="img" aria-label="関連図">
      <defs>{(Object.keys(EDGE) as EdgeKind[]).map(k => <marker key={k} id={"arrow-" + k} viewBox="0 0 10 10" refX={10 + (R + 2) / 0.8} refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill={EDGE[k]} /></marker>)}</defs>
      {/* 色の付いた線が上に来るように、関係ない線から先に描く */}
      {edges.sort((a, b) => rank(a.k) - rank(b.k)).map(({ p, i, k }) => <line key={p + i} x1={at(p)[0]} y1={at(p)[1]} x2={at(i)[0]} y2={at(i)[1]} stroke={EDGE[k]} strokeWidth={k === "in" || k === "out" ? 3 : 2} markerEnd={`url(#arrow-${k})`} />)}
      {items.map(i => { const [x, y] = at(i.itemId), on = i.itemId === selId, nb = near.has(i.itemId); return (
        <g key={i.itemId} className="node" tabIndex={0} onClick={() => onOpen(i.itemId)} onKeyDown={e => e.key === "Enter" && onOpen(i.itemId)}>
          <title>{i.itemName}</title>
          <circle cx={x} cy={y} r={R} fill={on ? "#f6dde2" : "#fffdf8"} stroke={on ? "#cf3f5b" : "#2a2740"} strokeWidth={on ? 3.5 : 2} opacity={has && !on && !nb ? 0.55 : 1} />
          {(() => { const ls = nodeLabel(i.itemName); return ls.map((t, k) => <text key={k} x={x} y={y + 5 + (k - (ls.length - 1) / 2) * 16} textAnchor="middle" fontSize="13" fontWeight={on ? 700 : 500} opacity={has && !on && !nb ? 0.6 : 1}>{t}</text>); })()}
        </g>); })}
    </svg>);
}
/** onOpen は画面遷移だけを行う関数を渡す前提で、比べない（毎回新しい関数でも描き直さない） */
export const RelationGraph = memo(Graph, (a, b) => a.items === b.items && a.prerequisites === b.prerequisites && a.selId === b.selId);
