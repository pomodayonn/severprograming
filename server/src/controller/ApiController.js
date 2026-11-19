// ApiController（Controller／バックエンド）：Render のサーバーの入口。ブラウザから HTTP で呼ばれる
//
// 【このファイルで何が起きているか】
// どのメソッドも、だいたい同じ順番で動きます（docs/API.md のとおり）
// 1. TokenVerifier で JWT を確かめて学生IDを取り出す。だめなら 401
// 2. 送られた形を確かめる。おかしければ 400、長すぎれば 413
// 3. 何回分使うかを数え、今日の残りが足りなければ AI を呼ばずに 429
// 4. AiService で AI を呼ぶ。どの AI もだめなら 503（このときは回数を数えない）
// 5. 成功したら AiUsageManager で回数を足し、remaining（残り）と limit（20）を付けて返す
// エラーは { error: { code: "..." } } の形で返す（フロントの services/api.ts がこれを読む）
// Java でいうと、サーブレットの doGet / doPost を URL ごとに分けたものです
import { DAILY_LIMIT } from "../managers/AiUsageManager.js";
import { AiUnavailableError } from "../boundary/AiService.js";
import {
  FRAME_TYPES, MAX_COUNT, SEND_LIMIT, lengthOf, countCalls, splitText, shareCount, mergeProposals,
  buildOrganize, readOrganize, buildEssay, readEssay, buildExplain, readExplain, buildRegenerate, readRegenerate,
} from "../service/AiPrompts.js";

/** エラーを決まった形で返す（message は開発者向け。画面には出さない） */
export function sendError(res, status, code, message) {
  res.status(status).json({ error: message ? { code, message } : { code } });
}

/** 送られた形がおかしいときに投げる（400） */
class BadRequest extends Error {}
/** 長すぎるときに投げる（413） */
class TooLong extends Error {}

const isText = (v) => typeof v === "string" && v.trim().length > 0;

/** { q, a } の形か確かめる */
function questionOf(v) {
  if (!v || !isText(v.q) || !isText(v.a)) throw new BadRequest("question には q と a（文字列）が必要です");
  return { q: v.q, a: v.a };
}

/** extra（追加の指示）は省略してよい。あるなら文字列 */
function extraOf(v) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new BadRequest("extra は文字列にしてください");
  return v.trim();
}

export class ApiController {
  /**
   * @param {import("../service/TokenVerifier.js").TokenVerifier} tokenVerifier
   * @param {import("../managers/AiUsageManager.js").AiUsageManager} aiUsageManager
   * @param {import("../boundary/AiService.js").AiService} aiService
   */
  constructor(tokenVerifier, aiUsageManager, aiService) {
    this.tokenVerifier = tokenVerifier;
    this.aiUsageManager = aiUsageManager;
    this.aiService = aiService;
  }

  /** JWT を確かめて学生IDを返す。だめなら 401 を返して null（呼んだ側はそこで終わる） */
  async studentIdOf(req, res) {
    const studentId = await this.tokenVerifier.verify(req.headers.authorization);
    if (!studentId) sendError(res, 401, "UNAUTHORIZED");
    return studentId;
  }

  /**
   * AIを使う4つのAPIで共通の流れ（上の 1〜5）
   * @param {(body: any) => { calls: number, run: () => Promise<object> }} prepare
   *   body を確かめて「何回分か」と「AIを呼ぶ処理」を返す関数
   */
  async useAi(req, res, prepare) {
    const studentId = await this.studentIdOf(req, res);
    if (!studentId) return;
    try {
      const { calls, run } = prepare(req.body ?? {});
      if (calls > DAILY_LIMIT) throw new TooLong(`1日の上限（${DAILY_LIMIT}回）を超える長さです`);
      if (!(await this.aiUsageManager.canUse(studentId, calls))) {
        return sendError(res, 429, "LIMIT_EXCEEDED", `${calls}回分が必要ですが、今日の残りが足りません`);
      }
      const result = await run(); // ここで失敗したら回数は数えない
      await this.aiUsageManager.addUsage(studentId, calls);
      const remaining = await this.aiUsageManager.getRemaining(studentId);
      res.json({ ...result, remaining, limit: DAILY_LIMIT });
    } catch (e) {
      if (e instanceof BadRequest) return sendError(res, 400, "BAD_REQUEST", e.message);
      if (e instanceof TooLong) return sendError(res, 413, "TOO_LONG", e.message);
      if (e instanceof AiUnavailableError) return sendError(res, 503, "AI_UNAVAILABLE", e.message);
      console.error("[API] 思いがけないエラー:", e);
      sendError(res, 500, "SERVER");
    }
  }

  /** GET /api/remaining：今日あと何回AIを使えるか */
  async getRemaining(req, res) {
    const studentId = await this.studentIdOf(req, res);
    if (!studentId) return;
    try {
      res.json({ remaining: await this.aiUsageManager.getRemaining(studentId), limit: DAILY_LIMIT });
    } catch (e) {
      console.error("[API] 残り回数を読めませんでした:", e);
      sendError(res, 500, "SERVER");
    }
  }

  /** POST /api/organize：ノートまとめ（G007） */
  organize(req, res) {
    return this.useAi(req, res, (body) => {
      const { text, frameTypes, frames = [] } = body;
      if (!isText(text)) throw new BadRequest("text が空です");
      if (!Array.isArray(frameTypes) || !frameTypes.length || !frameTypes.every((ft) => ft in FRAME_TYPES)) {
        throw new BadRequest(`frameTypes は ${Object.keys(FRAME_TYPES).join("・")} から1つ以上`);
      }
      if (!Array.isArray(frames) || !frames.every((f) => f && typeof f.id === "string")) {
        throw new BadRequest("frames は { id, ft } の配列にしてください");
      }
      return {
        calls: countCalls(text),
        run: async () => {
          // ふつうはフロントが1万文字ごとに分けて送ってくるので、chunks は1つだけ
          const lists = [];
          for (const chunk of splitText(text)) {
            lists.push(await this.aiService.send(buildOrganize(chunk, frameTypes), (r) => readOrganize(r, frameTypes, frames)));
          }
          return { proposals: mergeProposals(lists) };
        },
      };
    });
  }

  /** POST /api/essay-test：記述テストを作る（G008） */
  makeEssayTest(req, res) {
    return this.useAi(req, res, (body) => {
      const { text, count } = body;
      if (!isText(text)) throw new BadRequest("text が空です");
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new BadRequest(`count は 1〜${MAX_COUNT} の整数`);
      return {
        calls: countCalls(text),
        run: async () => {
          // 1万文字を超えたら分けて送り、問題数も分けた数に配る
          const chunks = splitText(text);
          const counts = shareCount(count, chunks.length);
          const questions = [];
          for (let i = 0; i < chunks.length; i++) {
            if (counts[i] === 0) continue;
            questions.push(...(await this.aiService.send(buildEssay(chunks[i], counts[i]), (r) => readEssay(r, counts[i]))));
          }
          return { questions };
        },
      };
    });
  }

  /** POST /api/explain：解説（G010） */
  explain(req, res) {
    return this.useAi(req, res, (body) => {
      const question = questionOf(body.question);
      const extra = extraOf(body.extra);
      if (lengthOf(question.q + question.a + extra) > SEND_LIMIT) throw new TooLong("問題と追加の指示で1万文字を超えています");
      return {
        calls: 1,
        run: async () => ({ explanation: await this.aiService.send(buildExplain(question, extra), readExplain) }),
      };
    });
  }

  /** POST /api/regenerate-question：記述テストの1問を作り直す（G010・G011） */
  regenerateQuestion(req, res) {
    return this.useAi(req, res, (body) => {
      const question = questionOf(body.question);
      const extra = extraOf(body.extra);
      if (lengthOf(question.q + question.a + extra) > SEND_LIMIT) throw new TooLong("問題と追加の指示で1万文字を超えています");
      return {
        calls: 1,
        run: async () => ({ question: await this.aiService.send(buildRegenerate(question, extra), readRegenerate) }),
      };
    });
  }
}