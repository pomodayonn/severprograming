// Test（テスト）（Entity Bean／フロントエンド）：模擬テスト
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";
import type { Question } from "./Question";
import type { Attempt } from "./Attempt";
import { TestType } from "../enums/TestType";

export class Test {
  /** テストID */
  testId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** 学習項目ID */
  itemId: string = "";
  /** テスト種類 */
  testType: TestType = TestType.MEANING_TO_TERM;
  /** 問題数 */
  questionCount: number = 0;
  /** 作成日時 */
  createdAt: DateTime = "";
  /** 最終受験日時（まだ解いていなければ null） */
  lastTakenAt: DateTime | null = null;
  /** 問題のリスト */
  questions: Question[] = [];
  /** 受験のリスト */
  attempts: Attempt[] = [];
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Test({ testId: "..." }) */
  constructor(init?: Partial<Test>) { Object.assign(this, init); }
}