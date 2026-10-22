// 保存先：端末(localStorage) と サーバー。旧版(素のJS)と同じキー・同じ形なので、いまのデータをそのまま読める。
import type { AppState } from "../types";
const KEY = "manabi-v2";

export function loadDevice(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const o = JSON.parse(raw) as Partial<AppState>;
    return { subjects: o.subjects ?? [], sel: o.sel ?? null, tab: o.tab ?? "note", user: o.user ?? null, store: o.store ?? "device", reviewOpen: o.reviewOpen ?? true, sideOpen: o.sideOpen ?? true, seen: o.seen ?? false };
  } catch { return null; }
}
export function saveDevice(s: AppState): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 容量オーバーでも動作は続ける */ } }
export async function saveServer(s: AppState): Promise<void> {
  const r = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }); // ← 実装時：自前API
  if (!r.ok) throw new Error("save");
}
