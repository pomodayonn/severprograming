// Prerequisite（前提項目）（Entity Bean／フロントエンド）：「この項目（itemId）の前提はこれ（prereqItemId）」の組み合わせ
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
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