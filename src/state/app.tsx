// アプリ全体の状態：ログイン中の学生・その学生のデータ・いまの画面・保存前のノート・確認ダイアログ
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

  useEffect(() => { // 前回ログインしたまま（Google から戻ってきたときも）なら、その学生のデータを開く
    let live = true;
    auth.getSession().then(a => { if (!live) return; if (a) { setAccount(a); setD(loadData(a.id)); setRoute({ s: "G003" }); } setReady(true); });
    return () => { live = false; };
  }, []);
  const setData = useCallback((f: (d: Data) => Data) => setD(prev => { const n = f(prev); if (aRef.current) saveData(aRef.current.id, n); return n; }), []);
  const ask = (msg: string, buttons: Btn[]) => new Promise<string>(res => setDlg({ msg, buttons, res }));
  const askName = (title: string, initial = "") => new Promise<string | null>(res => setPop({ title, val: initial, err: "", res }));
  const save = (itemId: string) => {
    const dr = dRef.current[itemId]; if (!dr) return;
    setData(d => ({ ...d, subjects: d.subjects.map(s => ({ ...s, items: s.items.map(i => i.id === itemId ? { ...i, note: { ...dr, savedAt: Date.now() } } : i) })) }));
    setDrafts(p => { const n = { ...p }; delete n[itemId]; return n; });
  };
  /** 保存していないノートがあれば確認する（D04）。移ってよければ true */
  const guard = async () => {
    const ids = Object.keys(dRef.current); if (!ids.length) return true;
    const v = await ask("保存していない変更があります", [{ label: "保存して移る", value: "save", primary: true }, { label: "保存せずに移る", value: "drop" }, { label: "キャンセル", value: "cancel" }]);
    if (v === "cancel") return false;
    if (v === "save") { ids.forEach(save); toast("保存したよ"); } else setDrafts({});
    return true;
  };
  const value: Ctx = {
    account, ready, data, setData, route, nav: r => setRoute(r), drafts,
    setDraft: (id, n) => setDrafts(p => { const c = { ...p }; if (n) c[id] = n; else delete c[id]; return c; }),
    tmp, setTmp: p => setT(t => ({ ...t, ...p })),
    enter: a => { setAccount(a); setD(loadData(a.id)); setRoute({ s: "G003" }); },
    leave: () => { void auth.signOut(); setAccount(null); setD(emptyData()); setDrafts({}); setRoute({ s: "G001" }); },
    ask, askName, guard, save,
    go: async r => { if (await guard()) setRoute(r); },
    logout: async () => { if (await guard()) { await auth.signOut(); setAccount(null); setD(emptyData()); setDrafts({}); setRoute({ s: "G001" }); } }, // 端末のデータは消さない
  };
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