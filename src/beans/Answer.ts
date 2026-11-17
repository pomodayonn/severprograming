// Answer（解答）（Entity Bean／フロントエンド）：1回の受験の中で、1問につき1つ
// 担当：（作成：11/10）。持つデータはクラス一覧（11/10版）のとおり
//
// 【このファイルで何が起きているか】
// 「1問ぶんの自分の解答」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（TestManager.submitAnswers）が new Answer({ ... }) で作る
// ・しまう：DAO（TestDAO（受験と一緒に保存））が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の answer テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
import type { DateTime } from "./DateTime";

export class Answer {
  /** 解答ID */
  answerId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** 受験ID */
  attemptId: string = "";
  /** 問題ID */
  questionId: string = "";
  /** 学生解答 */
  studentAnswer: string = "";
  /** 正誤（採点するのは「意味→用語」だけ。ほかは null） */
  correct: boolean | null = null;
  /** 解答日時 */
  answeredAt: DateTime = "";
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Answer({ answerId: "..." }) */
  constructor(init?: Partial<Answer>) { Object.assign(this, init); }
}