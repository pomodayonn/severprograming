// SendContent（送る内容）（Bean／フロントエンド）：AIに送る内容。送ったら使い終わりなので保存しない
// 持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// AIに送る文章（資料やノートから選んだもの）を入れておく入れ物です。
// ・作る：Controller が、G007 の画面で決めた文章から作る
// ・使う：AiSummaryManager（AIまとめ）や TestManager（記述テスト）がAIに送る
// ・送ったら使い終わりなので、どこにも保存しない

export class SendContent {
  /** 送る文章 */
  text: string = "";
  /** 文字数 */
  charCount: number = 0;

  /** 渡した分だけ値を入れて作る。例：new SendContent({ text: "..." }) */
  constructor(init?: Partial<SendContent>) { Object.assign(this, init); }
}