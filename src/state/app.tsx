// アプリ全体の状態：ログイン中の学生・その学生のデータ・いまの画面・保存前のノート・確認ダイアログ
//
// 【このファイルで何が起きているか】
// アプリ全体で共有する「今の状態」を持っている所です。どの画面からでも useApp() で使える。
// ・account：ログイン中の学生（いなければ null）
// ・subjects・items・prerequisites・notes・tests・materials：その学生のデータ。Controller（G003:loadSubjects）で Manager から読む
//   11/21：前は data.subjects・data.tests（localStorage の写し）を画面が読んでいたが、Manager のデータだけを見るようにした。
//   追加・保存などのあとは reload() で読み直す（写しを手で同じように書き換えることはしない）
//   11/21 道B：どれも beans（src/beans）のまま持つ。「この科目の学習項目」などは lib/select.ts の関数で探す
// ・route  ：今どの画面か（例：{ s: "G004", subjectId: "...", itemId: "..." }）
// ・drafts ：まだ「保存」していないノートの下書き（学習項目IDごとに、ノートの部品 NotePart のリスト）
// ログインからの流れ
//   1. ページを開く → getCurrentStudent で、前のログインが続いているか確かめる
//   2. 続いていれば open()
//   3. Controller（G003:loadSubjects）で Manager から科目・テスト・資料を読む
// 11/21（福山）：前の保存場所（localStorage・IndexedDB "runndesu"）からの引っ越しはやめた（チームでデータは消えてよいと決めた）。
//   残っている前のデータは、ページを開いたときに removeOldData() で消す
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Route } from "../types";
import type { Student } from "../beans/Student";
import type { Subject } from "../beans/Subject";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import type { Note } from "../beans/Note";
import type { NotePart } from "../beans/NotePart";
import type { Test } from "../beans/Test";
import type { Material } from "../beans/Material";
import { removeOldData } from "../services/db";
import { controller, type NoteConflict, type StudentData } from "../controller/Controller";
import { toast } from "../components/toast";
import { nameError } from "../lib/logic";

/** 確認ダイアログのボタン。primary＝主な操作（紺）、danger＝消す操作（赤） */
export interface Btn { label: string; value: string; primary?: boolean; danger?: boolean }
interface Ctx {
  account: Student | null; ready: boolean;
  subjects: Subject[]; items: LearningItem[]; prerequisites: Prerequisite[]; notes: Note[]; tests: Test[]; materials: Material[];
  loaded: boolean; reload: () => Promise<void>;
  route: Route; nav: (r: Route) => void;
  drafts: Record<string, NotePart[]>; setDraft: (itemId: string, parts: NotePart[] | null) => void;
  tmp: Record<string, unknown>; setTmp: (p: Record<string, unknown>) => void;
  enter: (a: Student) => void;
  ask: (msg: string, buttons: Btn[]) => Promise<string>;
  askName: (title: string, initial?: string) => Promise<string | null>;
  guard: () => Promise<boolean>; save: (itemId: string) => Promise<boolean>;
  go: (r: Route) => Promise<void>; logout: () => Promise<void>;
  /** 11/23：ヘッダーの「最新にする」。canRefresh＝同期する設定があるか、refreshing＝受け取っている最中か */
  canRefresh: boolean; refreshing: boolean; refresh: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(C); if (!c) throw new Error("AppProvider がありません"); return c; };
/** 表示に必要なデータがないとき、描画が終わってから別の画面へ移す（描画中に画面を変えない） */
export function Redirect({ to }: { to: Route }) {
  const { nav } = useApp();
  useEffect(() => { nav(to); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** まだ何も読んでいないとき */
const EMPTY: StudentData = { subjects: [], items: [], prerequisites: [], notes: [], tests: [], materials: [] };

export function AppProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Student | null>(null), [ready, setReady] = useState(false);
  const [db, setDb] = useState<StudentData>(EMPTY), [loaded, setLoaded] = useState(false);
  const seq = useRef(0); // reload が重なったとき、最後に頼んだ分だけを画面に出す
  const [route, setRoute] = useState<Route>({ s: "G001" });
  const [drafts, setDrafts] = useState<Record<string, NotePart[]>>({});
  const [tmp, setT] = useState<Record<string, unknown>>({});
  const [dlg, setDlg] = useState<{ msg: string; buttons: Btn[]; res: (v: string) => void } | null>(null);
  const [pop, setPop] = useState<{ title: string; val: string; err: string; res: (v: string | null) => void } | null>(null);
  const dRef = useRef(drafts); dRef.current = drafts;
  // 11/23：保存していないノートがあるときは、タブの名前に「●」を付け、タブを閉じる・再読み込みする前にブラウザが確認する
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    document.title = dirty ? "● るんです。" : "るんです。";
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const aRef = useRef(account); aRef.current = account;
  const rRef = useRef(route); rRef.current = route; // ログアウトのとき、いまの画面IDを Controller に渡す
  const [refreshing, setRefreshing] = useState(false);
  const canRefresh = controller.syncManager.enabled; // .env に Neon の設定がないとき（端末だけで動かすとき）はボタンを出さない

  /** 科目・テスト・資料を Manager から読み直す（Controller → G003:loadSubjects）。追加・保存などのあとに呼ぶ */
  const reload = useCallback(async () => {
    const a = aRef.current; if (!a) return;
    const n = ++seq.current;
    const r = await controller.handleRequest("G003", "loadSubjects", { studentId: a.studentId });
    if (r.error) { toast(r.error); if (n === seq.current) setLoaded(true); return; } // 失敗しても「読み込み中」のままにしない
    const d = r.data as StudentData | undefined;
    if (!d || n !== seq.current || aRef.current?.studentId !== a.studentId) return; // 古い結果・ほかの学生の結果は出さない
    setDb(d); setLoaded(true);
  }, []);
  const open = useCallback((a: Student) => {
    aRef.current = a; setAccount(a); setDb(EMPTY); setLoaded(false); setDrafts({}); setRoute({ s: "G003" });
    void reload();
  }, [reload]);
  const close = useCallback(() => { aRef.current = null; setAccount(null); setDb(EMPTY); setLoaded(false); setDrafts({}); setRoute({ s: "G001" }); }, []); // 端末のデータは消さない
  useEffect(() => { // 前回ログインしたまま（Google から戻ってきたときも）なら、その学生のデータを開く
    void removeOldData(); // 前の保存場所に残っているデータを消す（もう使わない）
    let live = true;
    controller.accountManager.getCurrentStudent().then(a => { if (!live) return; if (a) open(a); setReady(true); });
    return () => { live = false; };
  }, [open]);

  // 11/24：確認画面は1つずつ出す。開いている間に別の確認（ノートの食い違いの知らせなど）が来たら、閉じてから出す
  const dlgQueue = useRef<Promise<unknown>>(Promise.resolve());
  const ask = useCallback((msg: string, buttons: Btn[]) => {
    const p = dlgQueue.current.then(() => new Promise<string>(res => setDlg({ msg, buttons, res })));
    dlgQueue.current = p.catch(() => {});
    return p;
  }, []);
  const askName = useCallback((title: string, initial = "") => new Promise<string | null>(res => setPop({ title, val: initial, err: "", res })), []);
  // 11/23 バグ修正：Esc で窓を閉じる（入力欄の外にフォーカスがあっても）。確認の窓は「やめる」「キャンセル」がある時だけ、それを選んだことにする
  useEffect(() => {
    if (!dlg && !pop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pop) { e.preventDefault(); pop.res(null); setPop(null); return; }
      const cancel = dlg?.buttons.find(b => b.value === "no" || b.value === "cancel");
      if (dlg && cancel) { e.preventDefault(); dlg.res(cancel.value); setDlg(null); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [dlg, pop]);
  /** ノートを保存する（Controller → NoteManager）。保存できたら読み直して下書きを消し、true を返す */
  const save = useCallback(async (itemId: string) => {
    const dr = dRef.current[itemId], sid = aRef.current?.studentId; if (!dr || !sid) return false;
    const r = await controller.handleRequest("G004", "saveNote", { studentId: sid, itemId, parts: dr });
    if (r.error) { toast(r.error); return false; } // 保存できなかったときは下書きを残す
    await reload();
    setDrafts(p => { if (p[itemId] !== dr) return p; const n = { ...p }; delete n[itemId]; return n; }); // 保存中にさらに書いた分は残す
    return true;
  }, [reload]);
  /**
   * ノートの食い違い（11/24、UC-018 代替フロー(2)）。別の端末で、このノートがより新しく保存されていたら、どちらにするか選んでもらう。
   * 保存したとき・ネットにつながり直したとき・「最新にする」のときなど、SyncManager が見つけたらすぐに知らせてくる（NoteConflictListener）
   */
  const asking = useRef(new Set<string>()); // 同じノートの確認を2重に出さない
  const resolveConflict = useCallback(async (c: NoteConflict) => {
    const sid = aRef.current?.studentId; if (!sid || asking.current.has(c.noteId)) return;
    asking.current.add(c.noteId);
    try {
      const name = c.itemName ? `「${c.itemName}」の` : "";
      const choice = await ask(`別の端末で、${name}ノートがより新しく保存されています。どちらにしますか（「別の端末の内容にする」を選ぶと、この端末で変えた分は消えます）`,
        [{ label: "上書きして保存", value: "mine", primary: true }, { label: "別の端末の内容にする", value: "theirs", danger: true }]);
      const r = await controller.handleRequest("G004", "resolveNoteConflict", { studentId: sid, itemId: c.itemId, choice: choice === "theirs" ? "theirs" : "mine" });
      if (r.error) { toast(r.error); return; }
      if (choice === "theirs") { setDrafts(p => { if (!(c.itemId in p)) return p; const n = { ...p }; delete n[c.itemId]; return n; }); toast("別の端末の内容にしたよ"); }
      else toast("上書きして保存したよ");
      await reload();
    } finally { asking.current.delete(c.noteId); }
  }, [ask, reload]);
  useEffect(() => {
    controller.setNoteConflictListener({ onNoteConflict: list => { for (const c of list) void resolveConflict(c); } });
    return () => controller.setNoteConflictListener(null);
  }, [resolveConflict]);
  // ログインしたとき・ページを開き直したときに、まだ選んでいない食い違いがあれば出す（選ぶ前にタブを閉じたときのため）
  useEffect(() => { if (account) void controller.checkPendingNoteConflicts(); }, [account]);

  /** 保存していないノートがあれば確認する（D04）。移ってよければ true */
  const guard = useCallback(async () => {
    const ids = Object.keys(dRef.current); if (!ids.length) return true;
    const v = await ask("保存していない変更があります", [{ label: "保存して移る", value: "save", primary: true }, { label: "保存せずに移る", value: "drop" }, { label: "キャンセル", value: "cancel" }]);
    if (v === "cancel") return false;
    if (v === "save") { const ok = await Promise.all(ids.map(save)); if (ok.includes(false)) return false; toast("保存したよ"); } else setDrafts({});
    return true;
  }, [ask, save]);
  const nav = useCallback((r: Route) => setRoute(r), []);
  const setDraft = useCallback((id: string, n: NotePart[] | null) => setDrafts(p => {
    if (!n && !(id in p)) return p; // 変化なしなら作り直さない
    const c = { ...p }; if (n) c[id] = n; else delete c[id]; return c;
  }), []);
  const setTmp = useCallback((p: Record<string, unknown>) => setT(t => ({ ...t, ...p })), []);
  // ログアウトは Controller → AccountManager → NeonAuthClient の順に呼ぶ
  const go = useCallback(async (r: Route) => { if (await guard()) setRoute(r); }, [guard]);
  /**
   * ヘッダーの「ログアウト」（11/21：この端末のデータも消せるようにした）
   * 1. 保存していないノートがあれば確認（guard）
   * 2. 「消さずにログアウト」「この端末のデータも消してログアウト」「キャンセル」を選んでもらう
   * 3. 消すときに、アカウントに送れていない変更があれば、もう一度確認してから消す
   */
  const logout = useCallback(async () => {
    if (!(await guard())) return;
    const v = await ask("ログアウトします。この端末に保存したデータも消しますか（学校のPCなど、ほかの人も使う端末なら消すのがおすすめです。資料と文字起こしはこの端末にしかないので、消すと戻せません）",
      [{ label: "消さずにログアウト", value: "keep", primary: true }, { label: "この端末のデータも消してログアウト", value: "clear", danger: true }, { label: "キャンセル", value: "cancel" }]);
    if (v === "cancel") return;
    const s = rRef.current.s;
    let r = await controller.handleRequest(s, "logoutButton", { clearLocal: v === "clear" });
    if ((r.data as { unsent?: boolean } | undefined)?.unsent) {
      const w = await ask("まだアカウントに送れていない変更があります（オフラインだったときなど）。消すと、その変更は戻せません。消してログアウトしますか",
        [{ label: "消してログアウト", value: "force", danger: true }, { label: "やめる", value: "cancel" }]);
      if (w !== "force") return;
      r = await controller.handleRequest(s, "logoutButton", { clearLocal: true, force: true });
    }
    if (r.error) { toast(r.error); return; }
    if (v === "clear") toast("この端末のデータを消してログアウトしたよ");
    close();
  }, [guard, ask, close]);

  /**
   * ヘッダーの「最新にする」（11/23）。ふだんはページを開き直しても30分は受け取り直さないので、
   * 別の端末で変えた分をすぐ見たいときに押す。保存していないノートがあれば、先に確認する（guard）
   */
  const refresh = useCallback(async () => {
    if (refreshing || !(await guard())) return;
    setRefreshing(true);
    try {
      const r = await controller.handleRequest(rRef.current.s, "refreshButton");
      if (r.error) { toast(r.error); return; }
      await reload(); toast("最新にしたよ");
    } finally { setRefreshing(false); }
  }, [refreshing, guard, reload]);

  // 関数はすべて同じものを使い回すので、memo した部品は subjects・materials などが変わったときだけ描き直る
  const value = useMemo<Ctx>(() => ({
    account, ready, ...db, loaded, reload, route, nav, drafts, setDraft, tmp, setTmp,
    enter: open, ask, askName, guard, save, go, logout, canRefresh, refreshing, refresh,
  }), [account, ready, db, loaded, reload, route, nav, drafts, setDraft, tmp, setTmp, open, ask, askName, guard, save, go, logout, canRefresh, refreshing, refresh]);

  const submitPop = () => {
    if (!pop) return;
    const err = nameError(pop.val, "名前"); // 11/23：Manager の checkName と同じルール（絵文字も1文字と数える）
    if (err) return setPop({ ...pop, err });
    pop.res(pop.val.trim()); setPop(null);
  };
  return (
    <C.Provider value={value}>
      {children}
      {dlg && <div className="ov"><div className="dlg" role="dialog"><p>{dlg.msg}</p><div className="row">{dlg.buttons.map(b => <button key={b.value} className={"btn" + (b.danger ? " danger" : b.primary ? " pri" : " line")} onClick={() => { dlg.res(b.value); setDlg(null); }}>{b.label}</button>)}</div></div></div>}
      {pop && <div className="ov"><div className="dlg" role="dialog"><h3>{pop.title}</h3>
        <input autoFocus className="inp" value={pop.val} onChange={e => setPop({ ...pop, val: e.target.value, err: "" })} onKeyDown={e => { if (e.key === "Enter") submitPop(); }} placeholder="50文字まで" />
        {pop.err && <div className="err">{pop.err}</div>}
        <div className="row"><button className="btn line" onClick={() => { pop.res(null); setPop(null); }}>やめる</button><button className="btn pri" onClick={submitPop}>決定</button></div></div></div>}
    </C.Provider>
  );
}