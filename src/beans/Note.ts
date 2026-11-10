// Note（ノート）（Entity Bean／フロントエンド）：学習項目1つにノート1枚
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";
import type { NotePart } from "./NotePart";

export class Note {
  /** ノートID */
  noteId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** 学習項目ID */
  itemId: string = "";
  /** 最終保存日時（まだ保存していなければ null） */
  lastSavedAt: DateTime | null = null;
  /** 部品のリスト */
  parts: NotePart[] = [];
  /** 最終更新日時（同期で「前回より新しい行」を見分ける。Neon の updated_at） */
  updatedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Note({ noteId: "..." }) */
  constructor(init?: Partial<Note>) { Object.assign(this, init); }
}