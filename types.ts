// データの型。ER図(外部設計書 3章)と対応。資料の中身(MATERIAL)は端末のIndexedDBだけに置き、サーバーには送らない想定。
export interface Account { id: string; loginId: string; pass: string }
export type FrameType = "word" | "problem" | "formula" | "answer" | "method" | "summary";
export interface Word { term: string; meaning: string }
export interface El {
  id: string; kind: "frame" | "text" | "shape" | "arrow"; ft?: FrameType;
  x: number; y: number; w: number; h: number; color: string; text: string;
  words?: Word[]; head?: 0 | 1 | 2 | 3; shape?: "rect" | "ellipse"; at: number;
}
export interface Note { els: El[]; savedAt: number }
export interface Item { id: string; name: string; prereqs: string[]; note: Note }
export interface Subject { id: string; name: string; items: Item[] }
export interface MaterialMeta { id: string; itemId: string; name: string; type: "image" | "pdf" | "text" | "transcript"; size: number; srcId?: string; at: number }
export interface Question { q: string; a: string; expl?: string }
export type TestKind = "w-m2t" | "w-t2m" | "essay";
export interface Test { id: string; itemId: string; kind: TestKind; created: number; last?: number; qs: Question[]; ans?: string[]; ok?: boolean[] }
export interface Data { subjects: Subject[]; materials: MaterialMeta[]; tests: Test[]; usage: Record<string, number> }
export type Screen = "G001" | "G002" | "G003" | "G004" | "G005" | "G006" | "G007" | "G008" | "G009" | "G010" | "G011";
export interface Route {
  s: Screen; subjectId?: string; itemId?: string; materialId?: string; testId?: string;
  purpose?: "summary" | "essay"; mode?: "new" | "retry" | "list"; ans?: string[]; ok?: boolean[]; back?: Screen;
}
