// Word（単語）（Entity Bean／フロントエンド）：単語枠の中の用語と意味
// 持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「単語枠の中の単語1つ（用語と意味）」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（NoteManager）が new Word({ ... }) で作る
// ・しまう：DAO（NoteDAO（ノートと一緒に保存））が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の word テーブルに同期する（列の名前は snake_case になる）
// ・見せる：画面は Controller を通して受け取る
// 単語テスト（TestManager.createWordTest）は、ここから問題を作る
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