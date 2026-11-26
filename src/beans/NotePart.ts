// NotePart（ノート部品）（Entity Bean／フロントエンド）：枠・文字・図形・矢印の1つ分
// 持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「ノートの部品1つ（枠・文字・図形・矢印）」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（NoteManager）が new NotePart({ ... }) で作る
// ・しまう：DAO（NoteDAO（ノートと一緒に保存））が端末の IndexedDB に保存する
// ・送る ：SyncManager が Neon（クラウド）の note_part テーブルに同期する（列の名前は snake_case になる
// ・見せる：画面は Controller を通して受け取る
// x・y・width・height は、ノートの左上を (0, 0) にした位置と大きさ（px）
import type { DateTime } from "./DateTime";
import type { Word } from "./Word";
import { PartType } from "../enums/PartType";

/** 図形の形（四角・丸） */
export type ShapeKind = "rect" | "ellipse";

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
  /** 図形の形（四角・丸）。図形以外はnull */
  shape: ShapeKind | null = null;
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
  /** 文字の書式（11/25 追加）。文字ごとの太字・色・文字の種類などと、そろえ方を JSON の文字列で入れる。書式がなければ ""。
   *  形と読み書きは lib/rich.ts。text は今までどおり書式なしの文字なので、AI・単語テスト・検索はそのまま text を使えばよい */
  style: string = "";
  /** 最終更新日時 */
  updatedAt: DateTime = "";
  /** 単語のリスト（単語枠だけ） */
  words: Word[] = [];

  /** 渡した分だけ値を入れて作る。例：new NotePart({ partId: "..." }) */
  constructor(init?: Partial<NotePart>) { Object.assign(this, init); }

  // ---- 図形の形 ----
  // 図形の形はshapeに保存する。
  // 以前のtextに保存されたデータも読み取れるようにする。

  /** 図形の形を取得する */
  static shapeOf(part: NotePart): ShapeKind {
      if (part.shape === "rect" || part.shape === "ellipse") {
          return part.shape;
      }
      // 以前のtext列を使ったデータにも対応
      return part.text === "ellipse" ? "ellipse" : "rect";
  }

  /** 図形の形を変更する */
  static shapePatch(shape: ShapeKind): Partial<NotePart> {
      return { shape };
  }
}