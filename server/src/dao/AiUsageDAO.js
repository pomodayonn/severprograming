// AiUsageDAO（DAO／バックエンド）：ai_usage テーブルを読み書きする係
//
// 【このファイルで何が起きているか】
// ・find：学生IDと日付で1行を探す。まだ行がなければ「0回」の AiUsage を返す
// ・upsert：行がなければ追加、あれば回数を書き換える（INSERT ... ON CONFLICT DO UPDATE）
// SQL を書くのはこのクラスだけ。Manager は SQL を知らなくてよい（Java の DAO パターンと同じ）
import { sql } from "../db.js";
import { AiUsage } from "../beans/AiUsage.js";

export class AiUsageDAO {
  /**
   * @param {string} studentId
   * @param {string} useDate 日本時間の日付（"YYYY-MM-DD"）
   * @returns {Promise<AiUsage>}
   */
  async find(studentId, useDate) {
    if (!sql) throw new Error("DATABASE_URL がありません");
    const rows = await sql`
      SELECT count FROM ai_usage WHERE student_id = ${studentId} AND use_date = ${useDate}`;
    return new AiUsage(studentId, useDate, rows.length ? Number(rows[0].count) : 0);
  }

  /**
   * 行がなければ追加、あれば count を書き換える
   * @param {AiUsage} usage
   */
  async upsert(usage) {
    if (!sql) throw new Error("DATABASE_URL がありません");
    await sql`
      INSERT INTO ai_usage (student_id, use_date, count)
      VALUES (${usage.studentId}, ${usage.useDate}, ${usage.count})
      ON CONFLICT (student_id, use_date) DO UPDATE SET count = EXCLUDED.count`;
  }
}