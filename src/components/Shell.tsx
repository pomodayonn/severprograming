// 全画面共通の外枠：紫のヘッダー（ログアウト）＋ 左サイドバー（科目一覧の階層）＋ 中央 ＋ 右サイドバー
//
// 【このファイルで何が起きているか】
// どの画面にも出る外側の枠です（ヘッダー・左の一覧・真ん中・右の関連図の4か所）。
// 各画面は <Shell center={...} right={...} /> のように、真ん中と右に出すものだけを渡す

import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../state/app";
import { itemsOf, searchTree } from "../lib/select";
import { norm } from "../lib/logic";
import { Mascot } from "./Mascot";
import { RelationGraph } from "./RelationGraph";
import { OfflineBar } from "./AiWait";

export function Header({ plain = false }: { plain?: boolean }) {
  const { account, logout, canRefresh, refreshing, refresh } = useApp();
  return (<><header className="hd"><span className="ic"><Mascot size={30} /></span><b>るんです<span className="pd">。</span></b><span className="sp" />
    {!plain && account && <><span className="who">{account.mail}</span>
      {canRefresh && <button className="pill" onClick={refresh} disabled={refreshing} title="ほかの端末で変えた内容を受け取ります">{refreshing ? "受け取り中…" : "最新にする"}</button>}{/* 11/23 */}
      <button className="pill" onClick={logout}>ログアウト</button></>}</header><OfflineBar /></>);
  // ↑ ヘッダーの下に、オフラインのときだけ帯を出す（OfflineBar）。ヘッダーと帯を1つにまとめて返すため、下で包んでいる
}
/** 名前の中の、検索の言葉に合う所に印（mark）を付ける */
function Hit({ text, q }: { text: string; q: string }) {
  const k = q.trim() ? norm(text).indexOf(norm(q)) : -1;
  // norm で長さが変わる文字（全角英数など）は位置がずれるので、長さが同じときだけ印を付ける
  if (k < 0 || norm(text).length !== text.length) return <>{text}</>;
  const n = norm(q).length;
  return <span>{text.slice(0, k)}<mark>{text.slice(k, k + n)}</mark>{text.slice(k + n)}</span>; // 1つの span にまとめる（.ti は flex なので、分かれるとすき間ができる）
}
/** 左サイドバーの階層：科目（▼▶）の下に学習項目（●）。extra で選択中の項目の下に足せる
 *  11/23：上に検索欄。科目名か学習項目名で絞り込む（検索中は合った科目を全部開く） */
export function Tree({ heading, extra }: { heading: string; extra?: (itemId: string) => ReactNode }) {
  const { subjects, items, loaded, route, go } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({}), [q, setQ] = useState("");
  const found = useMemo(() => searchTree(subjects, items, q), [subjects, items, q]);
  const isOpen = (id: string) => found ? true : open[id] ?? id === route.subjectId;
  const shown = found ? subjects.filter(s => found.has(s.subjectId)) : subjects;
  return (<><div className="th">{heading}</div>
    {subjects.length > 0 && <div className="search"><input className="inp" type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Escape" && setQ("")} placeholder="科目・学習項目を検索" aria-label="科目・学習項目を検索" />{q && <button className="link" onClick={() => setQ("")} aria-label="検索を消す">×</button>}</div>}
    {shown.map(s => (<div key={s.subjectId}>
      <div className={"ts" + (route.s === "G003" && route.subjectId === s.subjectId ? " on" : "")} onClick={() => { setOpen({ ...open, [s.subjectId]: !isOpen(s.subjectId) }); if (route.s === "G003") go({ s: "G003", subjectId: s.subjectId }); }}>{isOpen(s.subjectId) ? "▼" : "▶"} <Hit text={s.subjectName} q={q} /></div>
      {isOpen(s.subjectId) && (found?.get(s.subjectId) ?? itemsOf(items, s.subjectId)).map(i => { const cur = route.s !== "G003" && route.itemId === i.itemId && route.subjectId === s.subjectId;
        return (<div key={i.itemId}><div className={"ti" + (cur ? " on" : "")} onClick={() => go({ s: "G004", subjectId: s.subjectId, itemId: i.itemId })}><i className="dot" /><Hit text={i.itemName} q={q} /></div>{extra && cur && extra(i.itemId)}</div>); })}
    </div>))}
    {found && !shown.length && <p className="mute">「{q.trim()}」に合う科目・学習項目はありません</p>}
    {!loaded && <p className="mute loading">読み込み中…</p>}
    {loaded && !subjects.length && <p className="mute">科目がまだありません</p>}</>);
}
export function GraphPane() {
  const { subjects, items, prerequisites, route, go } = useApp();
  const s = subjects.find(x => x.subjectId === route.subjectId);
  const its = useMemo(() => itemsOf(items, route.subjectId), [items, route.subjectId]); // 同じ間は関連図を描き直さない
  return s ? <RelationGraph items={its} prerequisites={prerequisites} selId={route.itemId} onOpen={id => go({ s: "G004", subjectId: s.subjectId, itemId: id })} /> : null;
}
export function Shell({ heading = "科目一覧", left, center, right, cls = "" }: { heading?: string; left?: ReactNode; center: ReactNode; right?: ReactNode; cls?: string }) {
  return (<div className="app"><Header /><div className={"cols " + cls}>
    <aside className="lf">{left ?? <Tree heading={heading} />}</aside><main className="ct">{center}</main><aside className="rt">{right ?? <GraphPane />}</aside></div></div>);
}
