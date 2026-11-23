// Suggestion（AIの提案）（Bean／フロントエンド）：AIまとめの提案1つ分。承認したものだけノートに反映し、提案そのものは保存しない
// 持つデータはクラス一覧（11/10版）のとおり
// 【このファイルで何が起きているか】
// AIまとめが返してきた「この枠にこう書いたら？」という提案1つを入れておく入れ物です。
// ・作る：AiSummaryManager.summarize がAIの答えから作る
// ・使う：画面で承認したもの（approved = true）だけ、NoteManager.mergeSuggestions でノートに入れる（保存は学習画面の「保存」で）
// ・提案そのものは保存しない

export class Suggestion {
  /** 対象の枠（新しい枠なら null） */
  targetPartId: string | null = null;
  /** 枠の種類 */
  frameType: string = "";
  /** 内容 */
  content: string = "";
  /** 承認したかどうか */
  approved: boolean = false;

  /** 渡した分だけ値を入れて作る。例：new Suggestion({ targetPartId: "..." }) */
  constructor(init?: Partial<Suggestion>) { Object.assign(this, init); }
}