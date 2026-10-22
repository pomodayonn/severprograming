import type { AppState, Item, Subject } from "../types";
import { DAY, blkHtml } from "./logic";

export const mk = (id: string, title: string, prereqs: string[] = []): Item =>
  ({ id, title, prereqs, note: "", history: [], srcText: "", sources: [], questions: [] });

/** クラウド上の運営教材（将来はAPI / GitHubから取得） */
export const CLOUD: Subject[] = [
  { id: "c-la", title: "線形代数", src: "official", items: [mk("vec", "ベクトル"), mk("mat", "行列の演算", ["vec"]), mk("det", "行列式", ["mat"]), mk("eig", "固有値・固有ベクトル", ["det"])] },
  { id: "c-calc", title: "微分積分", src: "official", items: [mk("lim", "極限"), mk("diff", "微分", ["lim"]), mk("int", "積分", ["diff"]), mk("tay", "テイラー展開", ["diff"])] },
  { id: "c-stat", title: "統計学入門", src: "official", items: [mk("dist", "確率分布"), mk("est", "推定", ["dist"]), mk("test", "仮説検定", ["est"])] },
];

export function seed(): AppState {
  const now = Date.now();
  const db: Subject = { id: "u-db", title: "大学のデータベース", src: "user", items: [mk("er", "ER図"), mk("norm", "正規化", ["er"]), mk("sql", "SQL基礎"), mk("sel", "SELECT文", ["sql"]), mk("join", "JOIN", ["sel"])] };
  db.items[2].note = "SQLはリレーショナルDBに問い合わせる言語。";
  db.items[2].noteHtml = blkHtml("f", "SELECT 列 FROM 表 WHERE 条件") + blkHtml("q", "SELECT文でWHEREの役割を説明しなさい。") + blkHtml("a", "行を条件で絞り込む。") + blkHtml("s", "まずFROMで表を決め、次にWHEREで行を絞り、最後にSELECTで列を選ぶ。");
  db.items[2].history.push({ at: now - 2 * DAY, kind: "test", score: 5 });
  db.items[3].history.push({ at: now - 9 * DAY, kind: "test", score: 3 });
  db.items[0].history.push({ at: now - DAY, kind: "note" });
  return { subjects: [structuredClone(CLOUD[0]), db], sel: null, tab: "note", user: null, store: "device", reviewOpen: true, sideOpen: true, seen: false };
}
