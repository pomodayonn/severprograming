// AiService（Boundary／バックエンド）：AIを順番に試して、最初にうまくいった返事を返す
//
// 【このファイルで何が起きているか】
// providers（Groq → NVIDIA NIM → Gemini）を前から順に試します。
// ・キーがない、文章が長すぎる → そのAIは飛ばす
// ・エラー（回数制限・サーバーダウン・時間切れなど）→ 次のAIへ
// ・返事が来ても、check で「使えない形」と分かったら → 次のAIへ
// 全部だめなら AiUnavailableError を投げる（ApiController が 503 AI_UNAVAILABLE にする）

export class AiUnavailableError extends Error {
  constructor(message = "どのAIも使えませんでした") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiService {
  /** @param {import("./AiProvider.js").AiProvider[]} providers 試す順番に並べる */
  constructor(providers) {
    this.providers = providers;
  }

  /**
   * プロンプトを送って、返事を返す
   * @template T
   * @param {string} prompt
   * @param {(reply: string) => T} [check] 返事を確かめて使える形に直す関数。だめなら例外を投げる（次のAIを試す）
   * @returns {Promise<T>}
   */
  async send(prompt, check = (r) => r) {
    const length = [...prompt].length; // 日本語も1文字ずつ数える
    for (const p of this.providers) {
      if (!p.canAccept(length)) continue;
      try {
        return check(await p.send(prompt));
      } catch (e) {
        console.warn(`[AI] ${p.name} が失敗したので次を試します:`, e instanceof Error ? e.message : e);
      }
    }
    throw new AiUnavailableError();
  }
}