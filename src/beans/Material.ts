// Material（資料）（Entity Bean／フロントエンド）：講義資料。端末（IndexedDB）だけに保存し、同期しない
// 担当：）。持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// 「講義資料1つ（画像・PDF・文字起こし）の情報」のデータを入れておく入れ物（Bean）です。中身を入れるだけで、計算や保存はしません。
// ・作る ：Manager（MaterialManager（まだないはず（）））が new Material({ ... }) で作る
// ・しまう：DAO（MaterialDAO）が端末の IndexedDB に保存する
// ・見せる：画面は Controller を通して受け取る
// 資料は端末だけに保存し、Neon には送らない（大きいファイルを送らないため
import type { DateTime } from "./DateTime";

export class Material {
  /** 資料ID */
  materialId: string = "";
  /** 学習項目ID */
  itemId: string = "";
  /** ファイル名 */
  fileName: string = "";
  /** ファイル種類（image・pdf・text・transcript） */
  fileType: string = "";
  /** ファイルサイズ（バイト） */
  fileSize: number = 0;
  /** 文字起こし元資料ID（.txt がどの資料から作られたか。元の資料なら null） */
  sourceMaterialId: string | null = null;
  /** 追加日時 */
  addedAt: DateTime = "";

  /** 渡した分だけ値を入れて作る。例：new Material({ materialId: "..." }) */
  constructor(init?: Partial<Material>) { Object.assign(this, init); }
}