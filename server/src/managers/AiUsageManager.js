// ★ DAILY_LIMIT（1日のAI利用回数の上限＝20）について ★
// 「20」は次の2か所に書いてあります。上限を変えるときは、必ず両方を一緒に変えること。
//   1. このファイルの DAILY_LIMIT（サーバーが数えるときの上限）
//   2. db/schema.sql の ai_usage テーブル：CHECK (count BETWEEN 0 AND 20)（DB担当のファイル）
// 片方だけ変えると、たとえば DAILY_LIMIT を 30 にしても DB が 21回目以降を受け付けず、エラーになります。
//
// AiUsageManager（Entity Manager／バックエンド）：AIの利用回数（1日20回）を管理する係
//
// 【このファイルで何が起きているか】
// ・getRemaining：今日あと何回使えるか
// ・reserve：AIを呼ぶ前に calls 回分を予約する（先に数える）。残りが足りなければ null（ApiController が 429 を返す）
// ・release：AIが失敗したとき、予約した分を戻す（＝失敗したときは数えない）
// 「今日」は日本時間で区切ります。Render のサーバーは UTC で動くので、そのまま new Date() を使うと
// 朝9時に日付が変わってしまうためです

export const DAILY_LIMIT = 20; // 1日に使えるAIの回数（上の★を読んでから変えること）

/** 日本時間の今日の日付を "YYYY-MM-DD" で返す（sv-SE の書式がちょうどこの形） */
export function todayJst(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export class AiUsageManager {
  /** @param {import("../dao/AiUsageDAO.js").AiUsageDAO} aiUsageDAO */
  constructor(aiUsageDAO) {
    this.aiUsageDAO = aiUsageDAO;
  }

  /** 今日あと何回使えるか */
  async getRemaining(studentId) {
    const usage = await this.aiUsageDAO.find(studentId, todayJst());
    return Math.max(0, DAILY_LIMIT - usage.count);
  }

    /**
   * AIを呼ぶ前に calls 回分を予約する。残りが足りなければ null。
   * 「残りを確かめる」と「足す」を DB の1文（AiUsageDAO.reserve）でやるので、
   * 同じ学生のリクエストがほぼ同時に来ても上限を超えない（Java の synchronized の代わりを DB がしてくれる）
   * @returns {Promise<{ useDate: string, remaining: number } | null>} 予約した日付（release で使う）と、予約したあとの残り回数
   */
  async reserve(studentId, calls) {
    const useDate = todayJst();
    const count = await this.aiUsageDAO.reserve(studentId, useDate, calls, DAILY_LIMIT);
    return count === null ? null : { useDate, remaining: Math.max(0, DAILY_LIMIT - count) };
  }


  /** AIが失敗したとき、予約した分を戻す。useDate は reserve が返した日付（夜12時をまたいでも、予約した日の分を戻すため） */
  async release(studentId, useDate, calls) {
    await this.aiUsageDAO.release(studentId, useDate, calls);
  }
}