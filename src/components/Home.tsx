import { useStore } from "../state/store";
import { greet, level, reviewTodo } from "../lib/logic";
import { Mascot } from "./Mascot";

export function Home({ go }: { go: () => void }) {
  const { state: st, dispatch } = useStore();
  const all = st.subjects.flatMap(s => s.items), todo = reviewTodo(st.subjects), n = todo.length;
  const weak = all.some(i => level(i) === 1);
  return (<>
    <div className="bar"><span className="crumb">ホーム</span></div>
    <div className="hello">
      <Mascot mood={n === 0 ? "cheer" : weak ? "worried" : "happy"} size={88} />
      <div><h1><mark>{n ? `${greet()}！今日は${n}個、復習しよっか` : `${greet()}！今日はゆっくりでOK`}</mark></h1>
        <p className="mute">忘れかけのものから順に並べたよ。押すとそのまま始められる。</p></div>
    </div>
    <ul className="todo">{todo.slice(0, 8).map(x => (
      <li key={x.s.id + x.i.id}><button onClick={() => { dispatch({ t: "open", s: x.s.id, i: x.i.id, tab: x.l === 0 ? "src" : "test" }); go(); }}>
        <i className={`dot l${x.l}`} /><span><b>{x.i.title}</b><small>{x.s.title}</small></span><em>{x.l === 0 ? "資料を入れる" : "説明テスト"}</em></button></li>))}</ul>
  </>);
}
