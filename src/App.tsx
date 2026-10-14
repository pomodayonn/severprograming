import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./components/Home";
import { ItemView } from "./components/ItemView";
import { Graph } from "./components/Graph";
import { Icon } from "./components/Icon";
import { Toast } from "./components/toast";

type Pane = "side" | "main" | "graph";
export default function App() {
  const { state: st, dispatch } = useStore();
  const [pane, setPane] = useState<Pane>("main");
  useEffect(() => {
    (["side", "main", "graph"] as Pane[]).forEach(p => document.body.classList.toggle("p-" + p, pane === p));
    document.body.classList.toggle("noside", !st.sideOpen);
  }, [pane, st.sideOpen]);
  const s = st.subjects.find(x => x.id === st.sel?.s), it = s?.items.find(x => x.id === st.sel?.i);
  const go = () => setPane("main");
  return (<>
    <div id="app">
      <section id="side" aria-label="教材"><Sidebar go={go} /></section>
      <section id="main" aria-label="学習画面">{s && it ? <ItemView key={s.id + it.id} s={s} it={it} /> : <Home go={go} />}</section>
      <section id="gsec" aria-label="関連図">{s && <Graph s={s} selId={it?.id ?? ""} onOpen={i => { dispatch({ t: "open", s: s.id, i }); go(); }} />}</section>
    </div>
    <button id="sideOpen" aria-label="サイドバーを開く" onClick={() => dispatch({ t: "set", patch: { sideOpen: true } })}><Icon n="menu" /></button>
    <nav className="bn" aria-label="画面切り替え">
      {([["side", "library", "教材"], ["main", "pen-line", "学習"], ["graph", "waypoints", "マップ"]] as [Pane, string, string][]).map(([p, ic, l]) =>
        <button key={p} onClick={() => setPane(p)}><span><Icon n={ic} s={22} /></span>{l}</button>)}
    </nav>
    <Toast />
  </>);
}
