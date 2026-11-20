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
// ・canUse：今日の残りで calls 回使えるか（足りなければ ApiController が 429 を返す）
// ・addUsage：AIが成功したあとに calls 回足し、足したあとの残り回数を返す（失敗したときは呼ばない＝数えない）
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

  /** 今日の残りで calls 回使えるか */
  async canUse(studentId, calls) {
    return (await this.getRemaining(studentId)) >= calls;
  }

  /**
   * calls 回足して、足したあとの残り回数を返す。
   * 「読む → 足す → 書く」を DB の1文（AiUsageDAO.increment）でやるので、
   * 同じ学生のリクエストがほぼ同時に来ても数え漏れが出ない（Java の synchronized の代わりを DB がしてくれる）
   */
  async addUsage(studentId, calls) {
    const count = await this.aiUsageDAO.increment(studentId, todayJst(), calls, DAILY_LIMIT);
    return Math.max(0, DAILY_LIMIT - count);
  }
}