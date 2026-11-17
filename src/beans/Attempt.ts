// Attempt（受験）（Entity Bean／フロントエンド）：1回解いた分の記録。初回も解き直しも、解くたびに1つ増える
// 担当）。持つデータはクラス一覧（11/10版）のとおり
//
// 【このファイルで何が起きているか】
// 「1回解いた記録（受験）」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（TestManager.submitAnswers）が new Attempt({ ... }) で作る
// ・しまう：DAO（TestDAO.insertAttempt）が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の attempt テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
// 解き直すたびに attemptNo が 1, 2, 3… と増え、前の回も消えずに残る
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