// Test（テスト）（Entity Bean／フロントエンド）：模擬テスト
// 担当：）。持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「模擬テスト1つ」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（TestManager）が new Test({ ... }) で作る
// ・しまう：DAO（TestDAO）が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の test テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
// 問題は questions、解いた記録（何回目か）は attempts に入る
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