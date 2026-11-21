// ★ DAILY_LIMIT（1日のAI利用回数の上限＝20）について ★
// 上限の値は managers/AiUsageManager.js の DAILY_LIMIT と、db/schema.sql の CHECK (count BETWEEN 0 AND 20) の2か所にあります。
// このファイルには「20」を直接書かず、reserve() の引数 max で受け取ります（変えるときは上の2か所だけ）。
//
// AiUsageDAO（DAO／バックエンド）：ai_usage テーブルを読み書きする係
//
// 【このファイルで何が起きているか】
// ・find：学生IDと日付で1行を探す。まだ行がなければ「0回」の AiUsage を返す
// ・reserve：上限を超えないときだけ回数を足して（予約して）、足したあとの回数を返す。超えるなら何もせず null
// ・release：予約した回数を戻す（AIが失敗したとき）
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
   * 上限 max を超えないときだけ、回数を calls 回足して（予約して）、足したあとの回数を返す。超えるなら何も変えずに null。
   * 「今の回数 + calls が max 以下か確かめる」と「足す」を DB の1文でやるので、
   * 同じ学生のリクエストがほぼ同時に来ても、2つとも通って上限を超えることはない（DB が1行ずつ順番に処理してくれる）
   * ・行がない（今日はじめて）→ INSERT で calls 回の行を作る
   * ・行がある → ON CONFLICT 側の UPDATE。WHERE が false（足すと上限を超える）なら更新されず、RETURNING も0行になる
   * @param {string} studentId
   * @param {string} useDate 日本時間の日付（"YYYY-MM-DD"）
   * @param {number} calls 足す回数
   * @param {number} max 上限（DAILY_LIMIT）
   * @returns {Promise<number | null>} 足したあとの回数。上限を超えるなら null
   */
  async reserve(studentId, useDate, calls, max) {
    if (!sql) throw new Error("DATABASE_URL がありません");
    if (calls > max) return null; // 1回で上限を超える量は、行を作る前に断る（DB の CHECK に引っかからないように）
    // ::int は「この値は整数」と DB に教える印
    const rows = await sql`
      INSERT INTO ai_usage (student_id, use_date, count)
      VALUES (${studentId}, ${useDate}, ${calls}::int)
      ON CONFLICT (student_id, use_date)
      DO UPDATE SET count = ai_usage.count + ${calls}::int
      WHERE ai_usage.count + ${calls}::int <= ${max}::int
      RETURNING count`;
    return rows.length ? Number(rows[0].count) : null;
  }


  /**
   * 予約した回数を戻す（AIが失敗したとき）。0 より下にはしない
   * @param {string} studentId
   * @param {string} useDate 予約したときの日付（日をまたいでも、予約した日の分を戻す）
   * @param {number} calls 戻す回数
   */
  async release(studentId, useDate, calls) {
    if (!sql) throw new Error("DATABASE_URL がありません");
    await sql`
      UPDATE ai_usage SET count = GREATEST(0, count - ${calls}::int)
      WHERE student_id = ${studentId} AND use_date = ${useDate}`;
  }
}