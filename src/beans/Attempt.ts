// Attempt（受験）（Entity Bean／フロントエンド）：1回解いた分の記録。初回も解き直しも、解くたびに1つ増える
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";
import type { Answer } from "./Answer";

export class Attempt {
  /** 受験ID */
  attemptId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** テストID */
  testId: string = "";
  /** 何回目か（1から） */
  attemptNo: number = 0;
  /** 解いた日時 */
  takenAt: DateTime = "";
  /** 解答のリスト */
  answers: Answer[] = [];
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Attempt({ attemptId: "..." }) */
  constructor(init?: Partial<Attempt>) { Object.assign(this, init); }
}