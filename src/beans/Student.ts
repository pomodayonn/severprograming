// Student（学生）（Entity Bean／フロントエンド）：ログイン中の学生。学生IDは Neon Auth（neon_auth.user）の ID。パスワードは Neon Auth が持つのでここにはない
// 担当：。持つデータはクラス一覧（11/10版）のとおり
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