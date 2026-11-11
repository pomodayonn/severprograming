// Manager で共通に使う部品（ID・エラー・同期・名前の確認）。同じものを各ファイルに書かないようにまとめた
// 担当：（11/11 リファクタリング）
import { SEND_LIMIT } from "../lib/logic";

/** 1回に送れる文字数（1万文字。これを超えると分けて送り、その分だけ利用回数を使う） */
export { SEND_LIMIT };

/**
 * 画面にそのまま出せる文を持ったエラー。各 Manager のエラー（AccountError・SubjectError など）はこれを継承する。
 * Controller は AppError なら message を画面に出し、それ以外は「うまくいきませんでした」にする
 */
export class AppError extends Error {}

/** SyncManager のうち、保存したあとに呼ぶ部分 */
export interface ChangePusher { pushChanges(): Promise<void> }

/** 新しいID（科目・学習項目・ノート・テストなど） */
export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** 保存したあとにアカウントへ送る。同期の失敗は保存の失敗にしない（端末には保存済みで、次回また送る） */
export async function pushQuietly(sync: ChangePusher | null): Promise<void> {
  try { await sync?.pushChanges(); } catch { /* 次回送る */ }
}

/** 名前を確認する。前後の空白を取って1〜50文字。だめなら Err（各 Manager のエラー）を投げる */
export function checkName(name: string, label: string, Err: new (message: string) => AppError): string {
  const n = name.trim();
  if (!n) throw new Err(`${label}を入力してください`);
  if ([...n].length > 50) throw new Err(`${label}は50文字までです`);
  return n;
}