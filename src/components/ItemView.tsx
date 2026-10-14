import type { Item, Subject, Tab } from "../types";
import { useStore } from "../state/store";
import { LV, level } from "../lib/logic";
import { NoteEditor } from "./NoteEditor";
import { SrcPanel } from "./SrcPanel";
import { TestPanel } from "./TestPanel";

const TABS: [Tab, string][] = [["note", "まとめノート"], ["src", "資料（写真）"], ["test", "説明テスト"]];

export function ItemView({ s, it }: { s: Subject; it: Item }) {
  const { state: st, dispatch } = useStore();
  const pre = it.prereqs.map(id => s.items.find(x => x.id === id)).filter((x): x is Item => !!x);
  const weak = pre.filter(p => level(p) < 2), k = s.items.indexOf(it);
  const open = (i: string) => dispatch({ t: "open", s: s.id, i });
  const nb = (o: number, l: string) => s.items[k + o] ? <button onClick={() => open(s.items[k + o].id)}>{l}</button> : <span />;
  return (<>
    <div className="bar"><span className="crumb">{s.title} › {it.title}</span></div>
    <header>
      <span className="badge">{s.src === "official" ? "運営教材" : "自分の教材"}</span><span className="mute">{s.title}</span>
      <h1><mark>{it.title}</mark></h1><span className={`chip l${level(it)}`}>{LV[level(it)]}</span>
    </header>
    {pre.length > 0 && <div className={"pre" + (weak.length ? " warn" : "")}><b>{weak.length ? "先にこっちを復習すると、すっと入るかも" : "前提項目"}</b>
      {pre.map(p => <button key={p.id} onClick={() => open(p.id)}><i className={`dot l${level(p)}`} />{p.title}</button>)}</div>}
    <div className="tabs">{TABS.map(([t, l]) => <button key={t} className={st.tab === t ? "on" : ""} onClick={() => dispatch({ t: "tab", tab: t })}>{l}</button>)}</div>
    {st.tab === "note" && <NoteEditor sid={s.id} it={it} />}
    {st.tab === "src" && <SrcPanel sid={s.id} it={it} />}
    {st.tab === "test" && <TestPanel sid={s.id} it={it} />}
    <h3>学習履歴</h3>
    <ul className="hist">{[...it.history].reverse().map((h, n) => <li key={n}><time>{new Date(h.at).toLocaleDateString("ja-JP")}</time>{h.kind === "note" ? "ノートを更新" : `説明テスト（自己評価 ${h.score}/5）`}</li>)}
      {!it.history.length && <li className="mute">まだ記録なし</li>}</ul>
    <div className="pn">{nb(-1, "← 前の項目")}{nb(1, "次の項目 →")}</div>
  </>);
}
