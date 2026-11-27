// 全画面共通の外枠：紫のヘッダー（ログアウト）＋ 左サイドバー（科目一覧の階層）＋ 中央 ＋ 右サイドバー
//
// 【このファイルで何が起きているか】
// どの画面にも出る外側の枠です（ヘッダー・左の一覧・真ん中・右の関連図の4か所）。
// 各画面は <Shell center={...} right={...} /> のように、真ん中と右に出すものだけを渡す

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useApp } from "../state/app";
import { itemsOf, searchTree } from "../lib/select";
import { clampPane, norm } from "../lib/logic";
import { Mascot } from "./Mascot";
import { RelationGraph } from "./RelationGraph";
import { OfflineBar } from "./AiWait";

export function Header({ plain = false }: { plain?: boolean }) {
  const {
    account, logout, canRefresh,
    refreshing, refresh,
    retrying, retrySync,
    go, route,
  } = useApp();
  // 11/25：ログインしているときは、左上のロゴを押すと科目一覧（G003）に戻る。保存していないノートがあれば先に聞く（go）
  const logo = <><span className="ic"><Mascot size={30} /></span><b>るんです<span className="pd">。</span></b></>;
  return (<><header className="hd">{!plain && account ? <button className="home" onClick={() => go({ s: "G003", subjectId: route.subjectId })} title="科目一覧へ戻る" aria-label="るんです。ホーム（科目一覧）">{logo}</button> : logo}<span className="sp" />
    {!plain && account && <><span className="who">{account.mail}</span>
      {canRefresh && (
        <>
          <button
            className="pill"
            onClick={retrySync}
            disabled={refreshing || retrying}
            title="端末に保存した変更をクラウドへ送信します"
          >
            {retrying ? "送信中…" : "クラウドへ送信"}
          </button>

          <button
            className="pill"
            onClick={refresh}
            disabled={refreshing || retrying}
            title="端末の変更を送信した後、クラウドの内容を取得します"
          >
            {refreshing ? "更新中…" : "クラウドから更新"}
          </button>
        </>
      )}

      <button
        className="pill"
        onClick={logout}
        disabled={refreshing || retrying}
      >
        ログアウト
      </button>
    </>}</header><OfflineBar /></>);
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
  const atList = route.s === "G003";
  const [open, setOpen] = useState<Record<string, boolean>>({}), [q, setQ] = useState("");
  const found = useMemo(() => searchTree(subjects, items, q), [subjects, items, q]);
  const isOpen = (id: string) => found ? true : open[id] ?? id === route.subjectId;
  const shown = found ? subjects.filter(s => found.has(s.subjectId)) : subjects;
  return (<><div className="th row"><span>{heading}</span><span className="sp" />{!atList && <button className="link tolist" onClick={() => go({ s: "G003", subjectId: route.subjectId })} title="科目の追加・名前の変更・削除ができる画面">科目一覧へ</button>}{/* 11/25 */}</div>
    {subjects.length > 0 && <div className="search"><input className="inp" type="text" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Escape" && setQ("")} placeholder="科目・学習項目を検索" aria-label="科目・学習項目を検索" />{q && <button className="link" onClick={() => setQ("")} aria-label="検索をクリア">×</button>}</div>}
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
/** 左右の欄の開け閉めと幅（11/25）。どの画面でも同じにして、次に開いたときも覚えておく（この端末だけ） */
interface Panes { lw: number; rw: number; lOpen: boolean; rOpen: boolean }
const PANES_KEY = "runndesu:panes", PANES0: Panes = { lw: 250, rw: 280, lOpen: true, rOpen: true };
function loadPanes(): Panes {
  try { const v = JSON.parse(localStorage.getItem(PANES_KEY) ?? "null"); return v ? { ...PANES0, ...v, lw: clampPane(Number(v.lw) || PANES0.lw), rw: clampPane(Number(v.rw) || PANES0.rw) } : PANES0; } catch { return PANES0; }
}
function savePanes(p: Panes) { try { localStorage.setItem(PANES_KEY, JSON.stringify(p)); } catch { /* 保存できなくても開け閉めはできる */ } }

/** 3列（左の欄・真ん中・右の欄）の入れ物。children に <aside className="lf"> <main className="ct"> <aside className="rt"> を入れる
 *  11/25：左右の欄は「‹」「›」で閉じたり開いたりでき、さかいめ（細い線）をドラッグすると幅を変えられる。スマホの幅では今までどおり縦に並ぶ */
export function Cols({ cls = "", children }: { cls?: string; children: ReactNode }) {
  const [pn, setPn] = useState<Panes>(loadPanes), drag = useRef<{ side: "l" | "r"; sx: number; w: number } | null>(null);
  const set = (p: Partial<Panes>) => setPn(o => { const n = { ...o, ...p }; savePanes(n); return n; });
  const start = (side: "l" | "r") => (e: RPointerEvent) => {
    e.preventDefault(); drag.current = { side, sx: e.clientX, w: side === "l" ? pn.lw : pn.rw };
    const mv = (ev: PointerEvent) => { const d = drag.current; if (!d) return; const w = clampPane(d.w + (d.side === "l" ? 1 : -1) * (ev.clientX - d.sx)); setPn(o => ({ ...o, [d.side === "l" ? "lw" : "rw"]: w })); };
    const up = () => { drag.current = null; window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); setPn(o => { savePanes(o); return o; }); document.body.classList.remove("resizing"); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); document.body.classList.add("resizing");
  };
  const style = { "--lw": pn.lOpen ? `${pn.lw}px` : "0px", "--rw": pn.rOpen ? `${pn.rw}px` : "0px" } as CSSProperties;
  return (<div className={"cols " + cls + (pn.lOpen ? "" : " lclosed") + (pn.rOpen ? "" : " rclosed")} style={style}>
    {children}
    {pn.lOpen && <div className="rz rzl" onPointerDown={start("l")} onDoubleClick={() => set({ lw: PANES0.lw })} title="ドラッグで幅を変える（ダブルクリックで元の幅）" />}
    {pn.rOpen && <div className="rz rzr" onPointerDown={start("r")} onDoubleClick={() => set({ rw: PANES0.rw })} title="ドラッグで幅を変える（ダブルクリックで元の幅）" />}
    <button className="ptog ptl" onClick={() => set({ lOpen: !pn.lOpen })} aria-label={pn.lOpen ? "左の欄を閉じる" : "左の欄を開く"} title={pn.lOpen ? "左の欄を閉じる" : "左の欄を開く"}>{pn.lOpen ? "‹" : "›"}</button>
    <button className="ptog ptr" onClick={() => set({ rOpen: !pn.rOpen })} aria-label={pn.rOpen ? "右の欄を閉じる" : "右の欄を開く"} title={pn.rOpen ? "右の欄を閉じる" : "右の欄を開く"}>{pn.rOpen ? "›" : "‹"}</button>
  </div>);
}

/** 画面の外枠：上にヘッダー、下に「左の欄・真ん中・右の欄」の3列（Cols） */
export function Shell({ heading = "科目一覧", left, center, right, cls = "" }: { heading?: string; left?: ReactNode; center: ReactNode; right?: ReactNode; cls?: string }) {
  return (<div className="app"><Header /><Cols cls={cls}>
    <aside className="lf">{left ?? <Tree heading={heading} />}</aside><main className="ct">{center}</main><aside className="rt">{right ?? <GraphPane />}</aside>
  </Cols></div>);
}
