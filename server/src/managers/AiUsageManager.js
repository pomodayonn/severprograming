// AiUsageManager（Entity Manager／バックエンド）：AIの利用回数（1日20回）を管理する係
//
// 【このファイルで何が起きているか】
// ・getRemaining：今日あと何回使えるか
// ・canUse：今日の残りで calls 回使えるか（足りなければ ApiController が 429 を返す）
// ・addUsage：AIが成功したあとに calls 回足す（失敗したときは呼ばない＝数えない）
// 「今日」は日本時間で区切ります。Render のサーバーは UTC で動くので、そのまま new Date() を使うと
// 朝9時に日付が変わってしまうためです
import { AiUsage } from "../beans/AiUsage.js";

export const DAILY_LIMIT = 20; // 1日に使えるAIの回数

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

  /** calls 回足す。20 を超えないようにする（テーブルの CHECK が 0〜20 のため） */
  async addUsage(studentId, calls) {
    const today = todayJst();
    const usage = await this.aiUsageDAO.find(studentId, today);
    await this.aiUsageDAO.upsert(new AiUsage(studentId, today, Math.min(DAILY_LIMIT, usage.count + calls)));
  }
}