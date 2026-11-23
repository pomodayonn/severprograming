// 関連図：学習項目を丸、前提のつながりを線で表す。丸を押すとその項目のノートに切り替える
// ノートを書いている間（items が同じ間）は配置を計算し直さず、描き直しもしない。
//
// 【このファイルで何が起きているか】
// 右側の関連図です。学習項目を丸、前提のつながりを線で描く。
// layout が「前提が何段あるか」を数えて、前提のない項目を左に、あとで学ぶ項目ほど右に並べる。
// 丸を押すと、その学習項目のノートに移る
import { memo, useMemo } from "react";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import { prereqIdsOf } from "../lib/select";
import { nodeLabel } from "../lib/logic";

/** 丸の半径と、丸どうしの横・縦の間隔（11/23：名前が読めるように大きくした） */
const R = 36, GX = 118, GY = 96;

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
  return (
    <svg viewBox={`0 0 ${g.W} ${g.H}`} style={{ maxWidth: g.W * 1.15 }} className="graph" role="img" aria-label="関連図">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX={10 + (R + 2) / 0.8} refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="#cdbfa8" /></marker></defs>
      {items.flatMap(i => prereqIdsOf(prerequisites, i.itemId).filter(p => g.pos.has(p)).map(p => <line key={p + i.itemId} x1={at(p)[0]} y1={at(p)[1]} x2={at(i.itemId)[0]} y2={at(i.itemId)[1]} stroke="#cdbfa8" strokeWidth="2" markerEnd="url(#arrow)" />))}
      {items.map(i => { const [x, y] = at(i.itemId), on = i.itemId === selId; return (
        <g key={i.itemId} className="node" tabIndex={0} onClick={() => onOpen(i.itemId)} onKeyDown={e => e.key === "Enter" && onOpen(i.itemId)}>
          <title>{i.itemName}</title>
          <circle cx={x} cy={y} r={R} fill={on ? "#f6dde2" : "#fffdf8"} stroke={on ? "#cf3f5b" : "#2a2740"} strokeWidth="2" />
          {(() => { const ls = nodeLabel(i.itemName); return ls.map((t, k) => <text key={k} x={x} y={y + 5 + (k - (ls.length - 1) / 2) * 16} textAnchor="middle" fontSize="13" fontWeight={on ? 700 : 500}>{t}</text>); })()}
        </g>); })}
    </svg>);
}
/** onOpen は画面遷移だけを行う関数を渡す前提で、比べない（毎回新しい関数でも描き直さない） */
export const RelationGraph = memo(Graph, (a, b) => a.items === b.items && a.prerequisites === b.prerequisites && a.selId === b.selId);
