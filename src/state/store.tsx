// 状態管理：useReducer + Context。画面の一時的な状態（入力中の文字など）は各コンポーネントの useState に置く。
import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import type { AppState, Attempt, Item, Tab } from "../types";
import { CLOUD, mk, seed } from "../lib/seed";
import { loadDevice, saveDevice, saveServer } from "../services/storage";

export type Action =
  | { t: "open"; s: string; i: string; tab?: Tab } | { t: "home" } | { t: "tab"; tab: Tab }
  | { t: "patch"; s: string; i: string; patch: Partial<Item> } | { t: "attempt"; s: string; i: string; a: Attempt }
  | { t: "addSubject"; title: string } | { t: "addItem"; s: string; title: string; prereq?: string }
  | { t: "install"; id: string } | { t: "set"; patch: Partial<AppState> };

const mapItem = (st: AppState, s: string, i: string, f: (it: Item) => Item): AppState =>
  ({ ...st, subjects: st.subjects.map(x => x.id !== s ? x : { ...x, items: x.items.map(it => it.id === i ? f(it) : it) }) });

function reducer(st: AppState, a: Action): AppState {
  switch (a.t) {
    case "open": return { ...st, sel: { s: a.s, i: a.i }, tab: a.tab ?? st.tab };
    case "home": return { ...st, sel: null };
    case "tab": return { ...st, tab: a.tab };
    case "patch": return mapItem(st, a.s, a.i, it => ({ ...it, ...a.patch }));
    case "attempt": return mapItem(st, a.s, a.i, it => ({ ...it, history: [...it.history, a.a] }));
    case "addSubject": return { ...st, subjects: [...st.subjects, { id: "u-" + Date.now(), title: a.title, src: "user", items: [] }], sel: null };
    case "addItem": {
      const n = mk("i" + Date.now(), a.title, a.prereq ? [a.prereq] : []);
      return { ...st, subjects: st.subjects.map(x => x.id === a.s ? { ...x, items: [...x.items, n] } : x), sel: { s: a.s, i: n.id } };
    }
    case "install": { const c = CLOUD.find(x => x.id === a.id); return c ? { ...st, subjects: [...st.subjects, structuredClone(c)] } : st; }
    case "set": return { ...st, ...a.patch };
  }
}

const Ctx = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadDevice() ?? seed());
  useEffect(() => { saveDevice(state); if (state.store === "server" && state.user) saveServer(state).catch(() => { /* 失敗時は端末に保存済み */ }); }, [state]);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}
export function useStore() { const c = useContext(Ctx); if (!c) throw new Error("StoreProvider がありません"); return c; }
