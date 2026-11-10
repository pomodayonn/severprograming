// Subject（科目）（Entity Bean／フロントエンド）：科目
// 担当）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";

export class Subject {
  /** 科目ID */
  subjectId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** 科目名（50文字まで） */
  subjectName: string = "";
  /** 作成日時 */
  createdAt: DateTime = "";
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Subject({ subjectId: "..." }) */
  constructor(init?: Partial<Subject>) { Object.assign(this, init); }
}