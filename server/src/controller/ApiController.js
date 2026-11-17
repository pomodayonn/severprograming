// ApiController（Controller／バックエンド）：Render のサーバーの入口。ブラウザから HTTP で呼ばれる
//
// 【このファイルで何が起きているか】
// どのメソッドも、最初に TokenVerifier で JWT を確かめて学生IDを取り出す。だめなら 401 を返して終わり
// エラーは docs/API.md のとおり { error: { code: "..." } } の形で返す（フロントの services/api.ts がこれを読む）


const DAILY_LIMIT = 20; // 1日に使えるAIの回数

/** エラーを決まった形で返す */
function sendError(res, status, code) {
  res.status(status).json({ error: { code } });
}

export class ApiController {
  /** @param {import("../service/TokenVerifier.js").TokenVerifier} tokenVerifier */
  constructor(tokenVerifier) {
    this.tokenVerifier = tokenVerifier;
  }

  /** JWT を確かめて学生IDを返す。だめなら 401 を返して null（呼んだ側はそこで終わる） */
  async studentIdOf(req, res) {
    const studentId = await this.tokenVerifier.verify(req.headers.authorization);
    if (!studentId) sendError(res, 401, "UNAUTHORIZED");
    return studentId;
  }

  /** GET /api/remaining：今日あと何回AIを使えるか。今はまだ回数を数えていないので 20 固定 */
  async getRemaining(req, res) {
    const studentId = await this.studentIdOf(req, res);
    if (!studentId) return;
    // TODO（作る順番②）：AiUsageManager.getRemaining(studentId) に置き換える
    res.json({ remaining: DAILY_LIMIT, limit: DAILY_LIMIT });
  }
}