// 関連図：学習項目を丸、前提のつながりを線で表す。丸を押すとその項目のノートに切り替える
// ノートを書いている間（items が同じ間）は配置を計算し直さず、描き直しもしない。
import { memo, useMemo } from "react";
import type { Item, Subject } from "../types";

function layout(items: Item[]) {
  const byId = new Map(items.map(i => [i.id, i])), depth = new Map<string, number>();
  const d = (id: string, seen: Set<string>): number => { // 前提の段数（輪になっていても止まる）
    const cached = depth.get(id); if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; seen.add(id);
    const pre = (byId.get(id)?.prereqs ?? []).filter(p => byId.has(p));
    const v = pre.length ? 1 + Math.max(...pre.map(p => d(p, seen))) : 0;
    seen.delete(id); depth.set(id, v); return v;
  };
  const cols = new Map<number, string[]>();
  for (const i of items) { const c = d(i.id, new Set()); (cols.get(c) ?? cols.set(c, []).get(c)!).push(i.id); }
  const pos = new Map<string, [number, number]>();
  let rows = 0;
  cols.forEach((ids, c) => { rows = Math.max(rows, ids.length); ids.forEach((id, r) => pos.set(id, [48 + c * 100, 44 + r * 76])); });
  return { pos, W: 100 + cols.size * 100, H: 90 + rows * 76 };
}

function Graph({ s, selId, onOpen }: { s: Subject; selId?: string; onOpen: (id: string) => void }) {
  const g = useMemo(() => layout(s.items), [s.items]);
  if (!s.items.length) return <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ろう。</p>;
  const at = (id: string) => g.pos.get(id)!;
  return (
    <svg viewBox={`0 0 ${g.W} ${g.H}`} className="graph" role="img" aria-label="関連図">
      {s.items.flatMap(i => i.prereqs.filter(p => g.pos.has(p)).map(p => <line key={p + i.id} x1={at(p)[0]} y1={at(p)[1]} x2={at(i.id)[0]} y2={at(i.id)[1]} stroke="#cdbfa8" strokeWidth="2" />))}
      {s.items.map(i => { const [x, y] = at(i.id), on = i.id === selId; return (
        <g key={i.id} className="node" tabIndex={0} onClick={() => onOpen(i.id)} onKeyDown={e => e.key === "Enter" && onOpen(i.id)}>
          <circle cx={x} cy={y} r="24" fill={on ? "#f6dde2" : "#fffdf8"} stroke={on ? "#cf3f5b" : "#2a2740"} strokeWidth="2" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="10">{i.name.length > 5 ? i.name.slice(0, 5) + "…" : i.name}</text>
        </g>); })}
    </svg>);
}
/** onOpen は画面遷移だけを行う関数を渡す前提で、比べない（毎回新しい関数でも描き直さない） */
export const RelationGraph = memo(Graph, (a, b) => a.s.items === b.s.items && a.selId === b.selId);
