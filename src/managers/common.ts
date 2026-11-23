// Manager で共通に使う部品（ID・エラー・同期・名前の確認）。同じものを各ファイルに書かないようにまとめた
// 担当：（11/11 リファクタリング）
// 【このファイルで何が起きているか】
// どの Manager でも使う小さな道具をまとめたファイルです。
// ・AppError   ：画面にそのまま見せてよいエラー。Manager はこれを throw し、Controller が文を画面に渡す
// ・newId      ：新しいIDを作る（ランダムな文字＋時刻なので、ほぼかぶらない）
// ・pushQuietly：保存のあとに Neon へ送る。失敗しても保存は成功扱い（端末には残っていて、次にまとめて送る）
// ・checkName  ：科目名・学習項目名の確認（空はだめ、50文字まで）
import { SEND_LIMIT, nameError, newId } from "../lib/logic";

/** 1回に送れる文字数（1万文字。これを超えると分けて送り、その分だけ利用回数を使う） */
export { SEND_LIMIT };

/**
 * 画面にそのまま出せる文を持ったエラー。各 Manager のエラー（AccountError・SubjectError など）はこれを継承する。
 * Controller は AppError なら message を画面に出し、それ以外は「うまくいきませんでした」にする
 */
export class AppError extends Error {}

/** SyncManager のうち、保存したあとに呼ぶ部分 */
export interface ChangePusher { pushChanges(): Promise<void> }

/** 新しいID（科目・学習項目・ノート・テストなど）。作り方は lib/logic.ts の newId 1か所だけ */
export { newId };

/** 保存したあとにアカウントへ送る。同期の失敗は保存の失敗にしない（端末には保存済みで、次回また送る） */
export async function pushQuietly(sync: ChangePusher | null): Promise<void> {
  try { await sync?.pushChanges(); } catch { /* 次回送る */ }
}

/** 名前を確認する。前後の空白を取って1〜50文字。だめなら Err（各 Manager のエラー）を投げる */
export function checkName(name: string, label: string, Err: new (message: string) => AppError): string {
  const err = nameError(name, label); // ルールは lib/logic.ts の nameError（画面のポップアップと同じ）
  if (err) throw new Err(err);
  return name.trim();
}