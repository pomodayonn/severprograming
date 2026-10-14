export type Src = "official" | "user";
export type Tab = "note" | "src" | "test";
export interface Attempt { at: number; kind: "note" | "test"; score?: number; text?: string }
export interface QA { q: string; a: string }
export interface Item {
  id: string; title: string; prereqs: string[];
  note: string; noteHtml?: string; history: Attempt[];
  srcText: string; sources: { url: string; at: number }[]; questions: QA[];
}
export interface Subject { id: string; title: string; src: Src; items: Item[] }
export interface AppState {
  subjects: Subject[]; sel: { s: string; i: string } | null; tab: Tab;
  user: { name: string } | null; store: "device" | "server";
  reviewOpen: boolean; sideOpen: boolean; seen: boolean;
}
