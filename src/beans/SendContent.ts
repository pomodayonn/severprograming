// SendContent（送る内容）（Bean／フロントエンド）：AIに送る内容。送ったら使い終わりなので保存しない
// 担当：）。持つデータはクラス一覧（11/10版）のとおり

export class SendContent {
  /** 元の資料IDのリスト */
  materialIds: string[] = [];
  /** 元の部品IDのリスト */
  partIds: string[] = [];
  /** 送る文章 */
  text: string = "";
  /** 文字数 */
  charCount: number = 0;

  /** 渡した分だけ値を入れて作る。例：new SendContent({ text: "..." }) */
  constructor(init?: Partial<SendContent>) { Object.assign(this, init); }
}