// AiUsage（Entity Bean／バックエンド）：ある学生が、ある日にAIを何回使ったか
//
// 【このファイルで何が起きているか】
// ai_usage テーブルの1行分を入れておく入れ物です。Java の Bean（フィールド＋getter）と同じ役割。
// useDate は日本時間の日付を "2026-11-19" の形の文字列で持ちます

export class AiUsage {
  /**
   * @param {string} studentId 学生ID（JWT の sub）
   * @param {string} useDate   日本時間の日付（例："2026-11-19"）
   * @param {number} count     その日に使った回数（0〜20）
   */
  constructor(studentId, useDate, count = 0) {
    this.studentId = studentId;
    this.useDate = useDate;
    this.count = count;
  }
}