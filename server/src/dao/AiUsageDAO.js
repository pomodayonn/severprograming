// ★ DAILY_LIMIT（1日のAI利用回数の上限＝20）について ★
// 上限の値は managers/AiUsageManager.js の DAILY_LIMIT と、db/schema.sql の CHECK (count BETWEEN 0 AND 20) の2か所にあります。
// このファイルには「20」を直接書かず、increment() の引数 max で受け取ります（変えるときは上の2か所だけ）。
//
// AiUsageDAO（DAO／バックエンド）：ai_usage テーブルを読み書きする係
//
// 【このファイルで何が起きているか】
// ・find：学生IDと日付で1行を探す。まだ行がなければ「0回」の AiUsage を返す
// ・increment：回数を足して、足したあとの回数を返す。行がなければ作る（INSERT ... ON CONFLICT DO UPDATE ... RETURNING）
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
   * 回数を calls 回足して、足したあとの回数を返す。max（DAILY_LIMIT）を超えないようにする。
   * 今の回数を JS で読んでから書き戻すと、同時に来たリクエストどうしで上書きし合って数え漏れが出るので、
   * 「今の回数 + calls」の計算は DB の中で1文のうちにやる（DB が1行ずつ順番に処理してくれる）
   * @param {string} studentId
   * @param {string} useDate 日本時間の日付（"YYYY-MM-DD"）
   * @param {number} calls 足す回数
   * @param {number} max 上限（DAILY_LIMIT）
   * @returns {Promise<number>} 足したあとの回数
   */
  async increment(studentId, useDate, calls, max) {
    if (!sql) throw new Error("DATABASE_URL がありません");
    // ::int は「この値は整数」と DB に教える印（LEAST の中だと型が分からず、文字列扱いされることがあるため）
    const rows = await sql`
      INSERT INTO ai_usage (student_id, use_date, count)
      VALUES (${studentId}, ${useDate}, LEAST(${max}::int, ${calls}::int))
      ON CONFLICT (student_id, use_date)
      DO UPDATE SET count = LEAST(${max}::int, ai_usage.count + ${calls}::int)
      RETURNING count`;
    return Number(rows[0].count);
  }
}