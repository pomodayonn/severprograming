// PartType（列挙型／フロントエンド）：ノート部品の種類
// 担当：野中（作成：東 11/10）。値は Neon の note_part.part_type と同じ
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