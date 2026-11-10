// NotePart（ノート部品）（Entity Bean／フロントエンド）：枠・文字・図形・矢印の1つ分
// 担当：野中（作成：東 11/10）。持つデータはクラス一覧（11/10版）のとおり
import type { DateTime } from "./DateTime";
import type { Word } from "./Word";
import { PartType } from "../enums/PartType";

export class NotePart {
  /** 部品ID */
  partId: string = "";
  /** 学生ID */
  studentId: string = "";
  /** ノートID */
  noteId: string = "";
  /** 部品の種類 */
  partType: PartType = PartType.FRAME;
  /** 枠の種類（枠でなければ null。最終一覧が決まるまで文字列） */
  frameType: string | null = null;
  /** X座標 */
  x: number = 0;
  /** Y座標 */
  y: number = 0;
  /** 幅 */
  width: number = 0;
  /** 高さ */
  height: number = 0;
  /** 色 */
  color: string = "";
  /** 部品内テキスト */
  text: string = "";
  /** 見出しレベル（0＝見出しでない、1〜3） */
  headingLevel: number = 0;
  /** 最終更新日時 */
  updatedAt: DateTime = "";
  /** 単語のリスト（単語枠だけ） */
  words: Word[] = [];

  /** 渡した分だけ値を入れて作る。例：new NotePart({ partId: "..." }) */
  constructor(init?: Partial<NotePart>) { Object.assign(this, init); }
}