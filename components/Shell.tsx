// 全画面共通の外枠：紫のヘッダー（ログアウト）＋ 左サイドバー（科目一覧の階層）＋ 中央 ＋ 右サイドバー
import { useState, type ReactNode } from "react";
import { useApp } from "../state/app";
import { Mascot } from "./Mascot";
import { RelationGraph } from "./RelationGraph";

export function Header({ plain = false }: { plain?: boolean }) {
  const { account, logout } = useApp();
  return (<header className="hd"><span className="ic"><Mascot size={30} /></span><b>るんです<span className="pd">。</span></b><span className="sp" />
    {!plain && account && <><span className="who">{account.loginId}</span><button className="pill" onClick={logout}>ログアウト</button></>}</header>);
}
/** 左サイドバーの階層：科目（▼▶）の下に学習項目（●）。extra で選択中の項目の下に足せる */
export function Tree({ heading, extra }: { heading: string; extra?: (itemId: string) => ReactNode }) {
  const { data, route, go } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => open[id] ?? id === route.subjectId;
  return (<><div className="th">{heading}</div>
    {data.subjects.map(s => (<div key={s.id}>
      <div className={"ts" + (route.s === "G003" && route.subjectId === s.id ? " on" : "")} onClick={() => { setOpen({ ...open, [s.id]: !isOpen(s.id) }); if (route.s === "G003") go({ s: "G003", subjectId: s.id }); }}>{isOpen(s.id) ? "▼" : "▶"} {s.name}</div>
      {isOpen(s.id) && s.items.map(i => { const cur = route.s !== "G003" && route.itemId === i.id && route.subjectId === s.id;
        return (<div key={i.id}><div className={"ti" + (cur ? " on" : "")} onClick={() => go({ s: "G004", subjectId: s.id, itemId: i.id })}><i className="dot" />{i.name}</div>{extra && cur && extra(i.id)}</div>); })}
    </div>))}
    {!data.subjects.length && <p className="mute">科目がまだありません</p>}</>);
}
export function GraphPane() {
  const { data, route, go } = useApp();
  const s = data.subjects.find(x => x.id === route.subjectId);
  return s ? <RelationGraph s={s} selId={route.itemId} onOpen={id => go({ s: "G004", subjectId: s.id, itemId: id })} /> : null;
}
export function Shell({ heading = "科目一覧", left, center, right, cls = "" }: { heading?: string; left?: ReactNode; center: ReactNode; right?: ReactNode; cls?: string }) {
  return (<div className="app"><Header /><div className={"cols " + cls}>
    <aside className="lf">{left ?? <Tree heading={heading} />}</aside><main className="ct">{center}</main><aside className="rt">{right ?? <GraphPane />}</aside></div></div>);
}
