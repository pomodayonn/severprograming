// つながりマップ：前提関係の階層レイアウト。丸の色=記憶の残り具合、大きさ=学習回数、顔=表情。
import type { Item, Subject } from "../types";
import { LV, hue, level, ret } from "../lib/logic";

function Face({ it, x, y, r }: { it: Item; x: number; y: number; r: number }) {
  const q = ret(it), m = q < 0 ? 0 : q > .55 ? 2 : q > .25 ? 1 : -1;
  const mouth: Record<number, string> = { 0: "M-3 7h6", 1: "M-5 6Q0 9 5 6", 2: "M-6 4Q0 12 6 4", [-1]: "M-6 9Q0 3 6 9" };
  return (
    <g className="face" transform={`translate(${x} ${y}) scale(${r / 24})`}>
      {m === 0 ? <path d="M-9 -3h5M4 -3h5" /> : <><circle cx="-6" cy="-3" r="2" /><circle cx="6" cy="-3" r="2" /></>}
      <path d={mouth[m]} />
    </g>
  );
}

export function Graph({ s, selId, onOpen }: { s: Subject; selId: string; onOpen: (id: string) => void }) {
  const depth: Record<string, number> = {};
  const d = (i: Item): number => (depth[i.id] ??= i.prereqs.length ? 1 + Math.max(...i.prereqs.map(p => { const x = s.items.find(y => y.id === p); return x ? d(x) : -1; })) : 0);
  s.items.forEach(d);
  const cols: Record<number, Item[]> = {};
  s.items.forEach(i => (cols[depth[i.id]] ??= []).push(i));
  const pos: Record<string, [number, number]> = {};
  Object.entries(cols).forEach(([c, arr]) => arr.forEach((i, r) => (pos[i.id] = [50 + +c * 110, 50 + r * 80])));
  if (!s.items.length) return <div id="graph"><p className="gh">{s.title}のつながり</p></div>;
  const W = 100 + (Math.max(...Object.keys(cols).map(Number)) + 1) * 110, H = 100 + Math.max(...Object.values(cols).map(a => a.length)) * 80;
  const cur = s.items.find(x => x.id === selId);
  const rel = new Set<string>(cur ? [cur.id, ...cur.prereqs, ...s.items.filter(x => x.prereqs.includes(cur.id)).map(x => x.id)] : []);
  return (
    <div id="graph">
      <p className="gh">{s.title}のつながり</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="学習項目の関連図">
        {s.items.flatMap(i => i.prereqs.filter(p => pos[p]).map(p => <line key={p + i.id} className={i.id === selId || p === selId ? "hi" : ""} x1={pos[p][0]} y1={pos[p][1]} x2={pos[i.id][0]} y2={pos[i.id][1]} />))}
        {s.items.map(i => {
          const [x, y] = pos[i.id], r = 20 + Math.min(10, i.history.length * 2);
          return (
            <g key={i.id} className={"node" + (selId === i.id ? " on" : "") + (cur && !rel.has(i.id) ? " dim" : "")} tabIndex={0}
              onClick={() => onOpen(i.id)} onKeyDown={e => e.key === "Enter" && onOpen(i.id)}>
              {level(i) === 1 && <circle className="ring" cx={x} cy={y} r={r} />}
              <circle cx={x} cy={y} r={r} fill={hue(i)} /><Face it={i} x={x} y={y} r={r} />
              <text x={x} y={y + r + 16}>{i.title}</text>
            </g>);
        })}
      </svg>
      <div className="legend"><span>忘れかけ</span><i className="grad" /><span>定着</span><span><i className="dot l0" />{LV[0]}</span><span>円が大きいほど学習回数が多い</span></div>
    </div>
  );
}
