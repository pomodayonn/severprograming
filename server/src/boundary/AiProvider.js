// AiProvider（Boundary／バックエンド）：AIサービス1つ分（Groq・NVIDIA NIM・Gemini のどれか1つ）
//
// 【このファイルで何が起きているか】
// 3つのAIサービスは、どれも OpenAI と同じ形（/chat/completions）で呼べます。
// なので「送り先のURL」「モデル名」「APIキー」だけを変えれば、同じクラスで3つとも扱えます。
// Java でいうと、同じクラスからインスタンスを3つ作って、フィールドの値だけ変えるイメージです
//
// ・canAccept：この長さの文章を受け取れるか（キーがない・長すぎるときは false で、次のAIに回す）
// ・send：プロンプトを送って、AIの返事（文字列）を返す。失敗したら例外を投げる

const TIMEOUT_MS = 60_000; // 60秒待っても返事がなければあきらめて次のAIへ

export class AiProvider {
  /**
   * @param {object} o
   * @param {string} o.name      表示用の名前（ログに出す）
   * @param {string} o.baseUrl   OpenAI 互換の入口（末尾は /v1 など。/chat/completions は付けない）
   * @param {string} o.model     モデル名
   * @param {number} o.maxChars  1回に受け取れる文字数（プロンプト全体）
   * @param {string} o.apiKeyEnv APIキーが入っている環境変数の名前（例："GROQ_API_KEY"）
   */
  constructor({ name, baseUrl, model, maxChars, apiKeyEnv }) {
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.maxChars = maxChars;
    this.apiKeyEnv = apiKeyEnv;
  }

  get apiKey() {
    return process.env[this.apiKeyEnv];
  }

  /** この長さの文章を受け取れるか */
  canAccept(charCount) {
    return !!this.apiKey && !!this.model && charCount <= this.maxChars;
  }

  /**
   * プロンプトを送って、AIの返事を返す
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async send(prompt) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "あなたは日本の学生の勉強を手伝うアシスタントです。指示された JSON だけを返してください。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        // response_format（JSONモード）は対応がAIごとにまちまちなので使わない。
        // 代わりにプロンプトで「JSONだけ返して」と頼み、AiPrompts の parseJson で取り出す
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // 本文の先頭だけログに残す（APIキーは本文に入らないので出しても大丈夫）
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`${this.name} が ${res.status} を返しました: ${body}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error(`${this.name} の返事が空でした`);
    return text;
  }
}

/**
 * 使うAIを、試す順番（Groq → NVIDIA NIM → Gemini）で作る
 * モデル名と文字数の上限は .env で変えられる（無料枠のモデルはよく入れ替わるため）
 */
export function defaultProviders(env = process.env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return [
    new AiProvider({
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: env.GROQ_MODEL || "openai/gpt-oss-120b",
      maxChars: num(env.GROQ_MAX_CHARS, 12000),
      apiKeyEnv: "GROQ_API_KEY",
    }),
    new AiProvider({
      name: "NVIDIA NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
      maxChars: num(env.NVIDIA_MAX_CHARS, 30000),
      apiKeyEnv: "NVIDIA_API_KEY",
    }),
    new AiProvider({
      name: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: env.GEMINI_MODEL || "gemini-3.8-flash",
      maxChars: num(env.GEMINI_MAX_CHARS, 100000),
      apiKeyEnv: "GEMINI_API_KEY",
    }),
  ];
}