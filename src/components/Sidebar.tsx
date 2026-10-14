import { useStore } from "../state/store";
import { CLOUD } from "../lib/seed";
import { level, reviewTodo } from "../lib/logic";
import type { Src, Tab } from "../types";
import { Icon } from "./Icon";
import { Mascot } from "./Mascot";

function AddItem({ sid, items }: { sid: string; items: { id: string; title: string }[] }) {
  const { dispatch } = useStore();
  return (
    <form className="add" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget), t = String(f.get("t") ?? "").trim(); if (!t) return;
      dispatch({ t: "addItem", s: sid, title: t, prereq: String(f.get("p") ?? "") || undefined }); e.currentTarget.reset();
    }}>
      <input name="t" placeholder="学習項目を追加" required />
      <select name="p"><option value="">前提なし</option>{items.map(i => <option key={i.id} value={i.id}>{i.title}の後</option>)}</select>
      <button>追加</button>
    </form>
  );
}

export function Sidebar({ go }: { go: () => void }) {
  const { state: st, dispatch } = useStore();
  const todo = reviewTodo(st.subjects);
  const installable = CLOUD.filter(c => !st.subjects.some(s => s.id === c.id));
  const open = (s: string, i: string, tab?: Tab) => { dispatch({ t: "open", s, i, tab }); go(); };
  const group = (src: Src, label: string) => {
    const list = st.subjects.filter(s => s.src === src);
    return (<>
      <h2>{label}</h2>
      {list.map(s => (
        <div className="subj" key={s.id}>
          <div className="row"><button className="sname" onClick={() => open(s.id, s.items[0]?.id ?? "")}>{s.title}</button></div>
          <progress max={3} value={s.items.length ? s.items.reduce((a, i) => a + level(i), 0) / s.items.length : 0} aria-label="習熟度" />
          <ul>{s.items.map(i => (
            <li className="row" key={i.id}>
              <button className={"it" + (st.sel?.s === s.id && st.sel.i === i.id ? " on" : "")} onClick={() => open(s.id, i.id)}><i className={`dot l${level(i)}`} />{i.title}</button>
            </li>))}</ul>
          {src === "user" && <AddItem sid={s.id} items={s.items} />}
        </div>))}
      {!list.length && <p className="mute">まだないよ</p>}
    </>);
  };
  return (<>
    <div className="brand">
      <button className="burger" aria-label="サイドバーを閉じる" onClick={() => dispatch({ t: "set", patch: { sideOpen: false } })}><Icon n="menu" /></button>
      <button className="logo" onClick={() => { dispatch({ t: "home" }); go(); }}><Mascot size={34} /><b>るんです<span>。</span></b></button>
    </div>
    <div className="rv">
      <button className="rvh" aria-expanded={st.reviewOpen} onClick={() => dispatch({ t: "set", patch: { reviewOpen: !st.reviewOpen } })}>
        <span>今日の復習 <b>{todo.length}</b></span><span><Icon n={st.reviewOpen ? "chevron-down" : "chevron-right"} s={16} /></span>
      </button>
      {st.reviewOpen && (todo.length
        ? <ul>{todo.slice(0, 6).map(x => <li key={x.s.id + x.i.id}><button onClick={() => open(x.s.id, x.i.id, x.l === 0 ? "src" : "test")}><i className={`dot l${x.l}`} />{x.i.title}</button></li>)}</ul>
        : <div className="rvdone"><Mascot mood="cheer" size={46} /><span>ぜんぶばっちり</span></div>)}
    </div>
    {group("official", "運営の教材")}
    {group("user", "自分の教材")}
    <form className="add" onSubmit={e => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get("t") ?? "").trim(); if (t) { dispatch({ t: "addSubject", title: t }); e.currentTarget.reset(); } }}>
      <input name="t" placeholder="科目をつくる" required /><button>作成</button>
    </form>
    <h2>教材をさがす</h2>
    {installable.map(c => <div className="store" key={c.id}><span>{c.title}</span><button onClick={() => dispatch({ t: "install", id: c.id })}>追加</button></div>)}
    {!installable.length && <p className="mute">ぜんぶ追加ずみ</p>}
  </>);
}
