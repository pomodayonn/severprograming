// Question（問題）（Entity Bean／フロントエンド）：テストの1問
// 担当：）。持つデータはクラス一覧（11/10版）のとおり

// 【このファイルで何が起きているか】
// 「テストの1問」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（TestManager）が new Question({ ... }) で作る
// ・しまう：DAO（TestDAO（テストと一緒に保存））が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の question テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る

import type { DateTime } from "./DateTime";

export class Question {
  /** 問題ID */
  questionId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** テストID */
  testId: string = "";
  /** 問題番号（1から） */
  number: number = 0;
  /** 問題文 */
  questionText: string = "";
  /** 模範解答 */
  modelAnswer: string = "";
  /** 解説（「解説」を押したときだけ作る） */
  explanation: string | null = null;
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Question({ questionId: "..." }) */
  constructor(init?: Partial<Question>) { Object.assign(this, init); }
}