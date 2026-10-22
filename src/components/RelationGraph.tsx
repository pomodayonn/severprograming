// 関連図：学習項目を丸、前提のつながりを線で表す。丸を押すとその項目のノートに切り替える
import type { Subject } from "../types";

export function RelationGraph({ s, selId, onOpen }: { s: Subject; selId?: string; onOpen: (id: string) => void }) {
  if (!s.items.length) return <p className="mute">学習項目がまだありません。左の「学習項目を追加」から作ろう。</p>;
  const depth: Record<string, number> = {};
  const d = (id: string, seen: string[] = []): number => depth[id] ??= seen.includes(id) ? 0 : (s.items.find(i => i.id === id)?.prereqs.length ? 1 + Math.max(...s.items.find(i => i.id === id)!.prereqs.map(p => d(p, [...seen, id]))) : 0);
  s.items.forEach(i => d(i.id));
  const cols: Record<number, string[]> = {}; s.items.forEach(i => (cols[depth[i.id]] ??= []).push(i.id));
  const pos: Record<string, [number, number]> = {};
  Object.entries(cols).forEach(([c, ids]) => ids.forEach((id, r) => (pos[id] = [48 + +c * 100, 44 + r * 76])));
  const W = 100 + Object.keys(cols).length * 100, Hh = 90 + Math.max(...Object.values(cols).map(a => a.length)) * 76;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="graph" role="img" aria-label="関連図">
      {s.items.flatMap(i => i.prereqs.filter(p => pos[p]).map(p => <line key={p + i.id} x1={pos[p][0]} y1={pos[p][1]} x2={pos[i.id][0]} y2={pos[i.id][1]} stroke="#cdbfa8" strokeWidth="2" />))}
      {s.items.map(i => (
        <g key={i.id} className="node" tabIndex={0} onClick={() => onOpen(i.id)} onKeyDown={e => e.key === "Enter" && onOpen(i.id)}>
          <circle cx={pos[i.id][0]} cy={pos[i.id][1]} r="24" fill={i.id === selId ? "#f6dde2" : "#fffdf8"} stroke={i.id === selId ? "#cf3f5b" : "#2a2740"} strokeWidth="2" />
          <text x={pos[i.id][0]} y={pos[i.id][1] + 4} textAnchor="middle" fontSize="10">{i.name.length > 5 ? i.name.slice(0, 5) + "…" : i.name}</text>
        </g>))}
    </svg>);
}
