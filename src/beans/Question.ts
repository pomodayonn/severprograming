// Question（問題）（Entity Bean／フロントエンド）：テストの1問
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
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