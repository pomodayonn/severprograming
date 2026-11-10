// LearningItem（学習項目）（Entity Bean／フロントエンド）：学習項目
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";

export class LearningItem {
  /** 学習項目ID */
  itemId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** 科目ID */
  subjectId: string = "";
  /** 学習項目名（50文字まで） */
  itemName: string = "";
  /** 作成日時 */
  createdAt: DateTime = "";
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new LearningItem({ itemId: "..." }) */
  constructor(init?: Partial<LearningItem>) { Object.assign(this, init); }
}