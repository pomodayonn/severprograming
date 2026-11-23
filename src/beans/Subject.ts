// Subject（科目）（Entity Bean／フロントエンド）：科目
// 持つデータはクラス一覧（11/10版）のとおり
//
// 【このファイルで何が起きているか】
// 「科目」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（SubjectManager）が new Subject({ ... }) で作る
// ・しまう：DAO（SubjectDAO）が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の subject テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
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