// Student（学生）（Entity Bean／フロントエンド）：ログイン中の学生。学生IDは Neon Auth（neon_auth.user）の ID。パスワードは Neon Auth が持つのでここにはない
// 持つデータはクラス一覧（11/10版）のとおり

// 【このファイルで何が起きているか】
// ログインしている学生の情報を入れておく入れ物（Bean）です。
// ・作る：AccountManager がログイン・登録したときに、Neon Auth の答えから作る
// ・学生ID（studentId）は、すべての科目やノートに付けて「誰のデータか」を表す。Neon の RLS はこの ID で「自分の行だけ」に絞る
import type { DateTime } from "./DateTime";

export class Student {
  /** 学生ID */
  studentId: string = "";
  /** メールアドレス */
  mail: string = "";
  /** 登録日時 */
  registeredAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Student({ studentId: "..." }) */
  constructor(init?: Partial<Student>) { Object.assign(this, init); }
}