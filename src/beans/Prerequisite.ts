// Prerequisite（前提項目）（Entity Bean／フロントエンド）：「この項目（itemId）の前提はこれ（prereqItemId）」の組み合わせ
// 担当）。持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「前提項目（どの項目を先に学ぶか）」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（LearningItemManager）が new Prerequisite({ ... }) で作る
// ・しまう：DAO（PrerequisiteDAO）が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の prerequisite テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
import type { DateTime } from "./DateTime";

export class Prerequisite {
  /** 学生ID */
  studentId: string = "";
  /** 学習項目ID */
  itemId: string = "";
  /** 前提学習項目ID */
  prereqItemId: string = "";
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Prerequisite({ studentId: "..." }) */
  constructor(init?: Partial<Prerequisite>) { Object.assign(this, init); }
}