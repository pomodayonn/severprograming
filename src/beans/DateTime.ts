// 日時はすべて ISO 8601 形式の文字列（例："2026-11-10T09:00:00.000Z"）。
// Neon の timestamptz とそのままやり取りでき、IndexedDB にもそのまま保存できる
export type DateTime = string;

/** 今の日時 */
export const now = (): DateTime => new Date().toISOString();