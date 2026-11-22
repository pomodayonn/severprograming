// config.js：サーバーの設定（チームで共有する値）
//
// 【このファイルで何が起きているか】
// AI の待つ時間・使うモデル・文字数の上限など、「秘密ではないけど、みんなで決める値」をここにまとめています。
// このファイルは GitHub に上げるので、変えたらコミットすれば全員（と Render）に反映されます。
// ・APIキーや DATABASE_URL などの秘密の値は、ここに書かないこと（server/.env に書く）
// ・値を変えたら、サーバーを起動し直す（npm run dev は自動で起動し直します）
// Java でいうと、定数をまとめた Config クラスのようなものです

export const AI_CONFIG = {
  /** 1つのAIを何ミリ秒待つか（120000 = 120秒）。過ぎたらあきらめて、グループの次のAIへ */
  timeoutMs: 120_000,

  /**
   * 11/22：送る文章の長さでグループを選び、グループの中のAIを上から順に（1つずつ時間いっぱい）試す。
   * グループの全部がだめなら失敗（ほかのグループには回さない）。1グループは2つまで → 最大 120秒×2 = 240秒。
   * フロント（src/services/api.ts）はそれより長い 250秒 待つので、時間切れでもサーバーが「失敗」を返し、利用回数を戻せる。
   * ・maxChars：このグループに入る文章の長さ（プロンプト全体）。上のグループから順に見て、最初に入るグループを使う
   * ・providers：試す順番（下の providers の name）
   * 将来「素早い／賢い」などを選べるようにするときは、ここにグループを足す
   */
  groups: [
    // 11/22 測った結果（bench-ai.js、1万文字）：Gemini 3.5 Flash-Lite 6.9秒で成功。
    //   Gemini 3.8 Flash・3.7 Flash は 503（混雑）か時間切れが多い。NVIDIA の minimax は200文字でも65秒かかる
    { name: "短い", maxChars: 7000, providers: ["Groq", "Gemini"] },
    { name: "長い", maxChars: 30000, providers: ["Gemini", "Gemini Flash"] },
  ],

  /**
   * 使うAI。上から順番に試す
   * ・model：モデル名。無料枠のモデルはよく入れ替わるので、使えなくなったらここを変える
   * ・maxChars：1回に送れる文字数（プロンプト全体）。これより長いとそのAIを飛ばして次へ
   * ・apiKeyEnv：APIキーが入っている .env の名前（キーそのものはここに書かない）
   */
  providers: [
    {
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      maxChars: 7000, // 無料枠は1分に8,000トークンまで。1万文字だと超えるので、長文は次のAIに回す
      apiKeyEnv: "GROQ_API_KEY",
    },
    {
      name: "NVIDIA NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "minimaxai/minimax-m3.1-flash", // 11/22：遅すぎるので groups から外した（使えるモデルが見つかったら戻す）
      maxChars: 30000,
      apiKeyEnv: "NVIDIA_API_KEY",
    },
    {
      name: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.5-flash-lite", // 11/22：3.8 Flash から変更（混雑しにくく速い）
      maxChars: 100000,
      apiKeyEnv: "GEMINI_API_KEY",
    },
    {
      name: "Gemini Flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.8-flash", // Flash-Lite がだめなときの予備（同じキー。モデルごとに上限は別）
      maxChars: 100000,
      apiKeyEnv: "GEMINI_API_KEY",
    },
  ],
};