// AiService（Boundary／バックエンド）：AIを順番に試して、最初にうまくいった返事を返す
//
// 【このファイルで何が起きているか】
// 11/22：送る文章の長さで、config.js の groups から使うグループを選ぶ（短い：Groq → Gemini、長い：Gemini → NVIDIA NIM）。
// グループの中のAIを上から順に試します。
// ・キーがない → そのAIは飛ばす
// ・エラー（回数制限・サーバーダウン・時間切れなど）→ グループの次のAIへ
// ・返事が来ても、check で「使えない形」と分かったら → グループの次のAIへ
// グループの全部がだめなら AiUnavailableError を投げる（ApiController が 503 AI_UNAVAILABLE にする）
// どのAIが何秒で答えたか（失敗したか）をログに出すので、試す順番を決める材料にする

export class AiUnavailableError extends Error {
  constructor(message = "どのAIも使えませんでした") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** 経過時間を「12.3秒」の形にする */
const sec = (start) => `${((Date.now() - start) / 1000).toFixed(1)}秒`;

export class AiService {
  /**
   * @param {Array<Pick<import("./AiProvider.js").AiProvider, "name" | "canAccept" | "send">>} providers 使えるAI（name で groups から選ぶ）
   * @param {{ name: string, maxChars: number, providers: string[] }[]} groups 長さごとのグループ（短い順に並べる）
   */
  constructor(providers, groups) {
    this.providers = providers;
    this.groups = groups;
  }

  /** 文章の長さに合うグループのAIを、試す順に返す。どのグループにも入らなければ空 */
  pick(length) {
    const group = this.groups.find((g) => length <= g.maxChars);
    if (!group) return [];
    return group.providers
      .map((name) => this.providers.find((p) => p.name === name))
      .filter((p) => p && p.canAccept(length));
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
    for (const p of this.pick(length)) {
      const start = Date.now();
      try {
        const result = check(await p.send(prompt));
        console.log(`[AI] ${p.name}：${length}文字 → ${sec(start)}で成功`);
        return result;
      } catch (e) {
        console.warn(`[AI] ${p.name}：${length}文字 → ${sec(start)}で失敗。次を試します:`, e instanceof Error ? e.message : e);
      }
    }
    throw new AiUnavailableError();
  }
}
