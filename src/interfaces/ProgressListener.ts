// ProgressListener（インターフェース／フロントエンド）：文字起こしの進み具合を知らせてもらう係
//
// 【このファイルで何が起きているか】
// Java の ActionListener と同じ考え方。画面がこれを実装（implements）したものを MaterialManager.transcribe() に渡すと、
// 文字起こしが進むたびに onProgress(パーセント) が呼ばれ、画面が「文字起こし中… 40%」のように表示を変える
// ・画像：Tesseract.js が知らせる 0〜1 の進み具合 × 100
// ・PDF ：（終わったページ数 + 今のページの進み具合）÷ 全ページ数 × 100
export interface ProgressListener {
  /** 進むたびに呼ばれる（percent は 0〜100 の整数） */
  onProgress(percent: number): void;
}
