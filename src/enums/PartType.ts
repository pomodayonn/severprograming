// PartType（列挙型／フロントエンド）：ノート部品の種類
// 。値は Neon の note_part.part_type と同じ
//
// 【このファイルで何が起きているか】
// ノート部品の種類を、決まった4つの名前だけに限るための「列挙型（enum）」です。
// 文字列で "frame" や "Frame" と書き間違えるのを防ぐ。例：part.partType === PartType.FRAME
export enum PartType {
  /** 枠 */
  FRAME = "FRAME",
  /** 文字 */
  TEXT = "TEXT",
  /** 図形 */
  SHAPE = "SHAPE",
  /** 矢印 */
  ARROW = "ARROW",
}