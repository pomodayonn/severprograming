// Word（単語）（Entity Bean／フロントエンド）：単語枠の中の用語と意味
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";

export class Word {
  /** 単語ID */
  wordId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** ノート部品ID */
  partId: string = "";
  /** 用語 */
  term: string = "";
  /** 意味 */
  meaning: string = "";
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Word({ wordId: "..." }) */
  constructor(init?: Partial<Word>) { Object.assign(this, init); }
}