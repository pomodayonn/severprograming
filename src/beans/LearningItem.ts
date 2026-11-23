// LearningItem（学習項目）（Entity Bean／フロントエンド）：学習項目
// 持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「学習項目」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（LearningItemManager）が new LearningItem({ ... }) で作る
// ・しまう：DAO（LearningItemDAO）が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の learning_item テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
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