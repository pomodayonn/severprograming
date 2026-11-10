// アプリ全体の状態：ログイン中の学生・その学生のデータ・いまの画面・保存前のノート・確認ダイアログ
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Data, Note, Route, Student } from "../types";
import { emptyData, loadData, saveData } from "../services/db";
import { auth } from "../services/auth";
import { toast } from "../components/toast";

export interface Btn { label: string; value: string; primary?: boolean }
interface Ctx {
  account: Student | null; ready: boolean; data: Data; setData: (f: (d: Data) => Data) => void;
  route: Route; nav: (r: Route) => void;
  drafts: Record<string, Note>; setDraft: (itemId: string, n: Note | null) => void;
  tmp: Record<string, unknown>; setTmp: (p: Record<string, unknown>) => void;
  enter: (a: Student) => void; leave: () => void;
  ask: (msg: string, buttons: Btn[]) => Promise<string>;
  askName: (title: string, initial?: string) => Promise<string | null>;
  guard: () => Promise<boolean>; save: (itemId: string) => void;
  go: (r: Route) => Promise<void>; logout: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error("AppProvider がありません"); return c; };
/** 表示に必要なデータがないとき、描画が終わってから別の画面へ移す（描画中に画面を変えない） */
export function Redirect({ to }: { to: Route }) {
  const { nav } = useApp();
  useEffect(() => { nav(to); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** 端末への保存は、続けて変更があっても最後の1回にまとめる（毎回 JSON を書くと重い） */
const SAVE_DELAY = 400;

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Student | null>(null), [ready, setReady] = useState(false);
  const [data, setD] = useState<Data>(emptyData());
  const [route, setRoute] = useState<Route>({ s: "G001" });
  const [drafts, setDrafts] = useState<Record<string, Note>>({});
  const [tmp, setT] = useState<Record<string, unknown>>({});
  const [dlg, setDlg] = useState<{ msg: string; buttons: Btn[]; res: (v: string) => void } | null>(null);
  const [pop, setPop] = useState<{ title: string; val: string; err: string; res: (v: string | null) => void } | null>(null);
  const dRef = useRef(drafts); dRef.current = drafts;
  const aRef = useRef(account); aRef.current = account;

  // ---- 保存（まとめて書く）----
  const pending = useRef<{ id: string; data: Data } | null>(null), timer = useRef(0);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current; pending.current = null;
    if (p) saveData(p.id, p.data);
  }, []);
  useEffect(() => { // タブを閉じる・裏に回るときは、待たずに書き込む
    const onHide = () => flush();
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", onHide); document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", onHide); document.removeEventListener("visibilitychange", onVis); flush(); };
  }, [flush]);
  const setData = useCallback((f: (d: Data) => Data) => setD(prev => {
    const n = f(prev), a = aRef.current;
    if (a) { // ここでは予約だけ（StrictMode で2回呼ばれても書き込みは1回）
      pending.current = { id: a.id, data: n };
      clearTimeout(timer.current); timer.current = window.setTimeout(flush, SAVE_DELAY);
    }
    return n;
  }), [flush]);

  const open = useCallback((a: Student) => { flush(); setAccount(a); setD(loadData(a.id)); setDrafts({}); setRoute({ s: "G003" }); }, [flush]);
  const close = useCallback(() => { flush(); setAccount(null); setD(emptyData()); setDrafts({}); setRoute({ s: "G001" }); }, [flush]); // 端末のデータは消さない

  useEffect(() => { // 前回ログインしたまま（Google から戻ってきたときも）なら、その学生のデータを開く
    let live = true;
    auth.getSession().then(a => { if (!live) return; if (a) open(a); setReady(true); });
    return () => { live = false; };
  }, [open]);

  const ask = useCallback((msg: string, buttons: Btn[]) => new Promise<string>(res => setDlg({ msg, buttons, res })), []);
  const askName = useCallback((title: string, initial = "") => new Promise<string | null>(res => setPop({ title, val: initial, err: "", res })), []);
  const save = useCallback((itemId: string) => {
    const dr = dRef.current[itemId]; if (!dr) return;
    setData(d => ({ ...d, subjects: d.subjects.map(s => ({ ...s, items: s.items.map(i => i.id === itemId ? { ...i, note: { ...dr, savedAt: Date.now() } } : i) })) }));
    setDrafts(p => { const n = { ...p }; delete n[itemId]; return n; });
  }, [setData]);
  /** 保存していないノートがあれば確認する（D04）。移ってよければ true */
  const guard = useCallback(async () => {
    const ids = Object.keys(dRef.current); if (!ids.length) return true;
    const v = await ask("保存していない変更があります", [{ label: "保存して移る", value: "save", primary: true }, { label: "保存せずに移る", value: "drop" }, { label: "キャンセル", value: "cancel" }]);
    if (v === "cancel") return false;
    if (v === "save") { ids.forEach(save); toast("保存したよ"); } else setDrafts({});
    return true;
  }, [ask, save]);
  const nav = useCallback((r: Route) => setRoute(r), []);
  const setDraft = useCallback((id: string, n: Note | null) => setDrafts(p => {
    if (!n && !(id in p)) return p; // 変化なしなら作り直さない
    const c = { ...p }; if (n) c[id] = n; else delete c[id]; return c;
  }), []);
  const setTmp = useCallback((p: Record<string, unknown>) => setT(t => ({ ...t, ...p })), []);
  const leave = useCallback(() => { void auth.signOut(); close(); }, [close]);
  const go = useCallback(async (r: Route) => { if (await guard()) setRoute(r); }, [guard]);
  const logout = useCallback(async () => { if (await guard()) { await auth.signOut(); close(); } }, [guard, close]);

  // 関数はすべて同じものを使い回すので、memo した部品は data などが変わったときだけ描き直る
  const value = useMemo<Ctx>(() => ({
    account, ready, data, setData, route, nav, drafts, setDraft, tmp, setTmp,
    enter: open, leave, ask, askName, guard, save, go, logout,
  }), [account, ready, data, setData, route, nav, drafts, setDraft, tmp, setTmp, open, leave, ask, askName, guard, save, go, logout]);

  const submitPop = () => {
    if (!pop) return; const v = pop.val.trim();
    if (!v) return setPop({ ...pop, err: "名前が入力されていません" });
    if (v.length > 50) return setPop({ ...pop, err: "文字数が多すぎます（50文字まで）" });
    pop.res(v); setPop(null);
  };
  return (
    <C.Provider value={value}>
      {children}
      {dlg && <div className="ov"><div className="dlg" role="dialog"><p>{dlg.msg}</p><div className="row">{dlg.buttons.map(b => <button key={b.value} className={"btn" + (b.primary ? " pri" : "")} onClick={() => { dlg.res(b.value); setDlg(null); }}>{b.label}</button>)}</div></div></div>}
      {pop && <div className="ov"><div className="dlg" role="dialog"><h3>{pop.title}</h3>
        <input autoFocus className="inp" value={pop.val} onChange={e => setPop({ ...pop, val: e.target.value, err: "" })} onKeyDown={e => e.key === "Enter" && submitPop()} placeholder="50文字まで" />
        {pop.err && <div className="err">{pop.err}</div>}
        <div className="row"><button className="btn" onClick={() => { pop.res(null); setPop(null); }}>やめる</button><button className="btn pri" onClick={submitPop}>決定</button></div></div></div>}
    </C.Provider>
  );
}
