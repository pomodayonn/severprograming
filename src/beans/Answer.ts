// Answer（解答）（Entity Bean／フロントエンド）：1回の受験の中で、1問につき1つ
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
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