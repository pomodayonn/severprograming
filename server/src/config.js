// config.js：サーバーの設定（チームで共有する値）
//
// 【このファイルで何が起きているか】
// AI の待つ時間・使うモデル・文字数の上限など、「秘密ではないけど、みんなで決める値」をここにまとめています。
// このファイルは GitHub に上げるので、変えたらコミットすれば全員（と Render）に反映されます。
// ・APIキーや DATABASE_URL などの秘密の値は、ここに書かないこと（server/.env に書く）
// ・値を変えたら、サーバーを起動し直す（npm run dev は自動で起動し直します）
// Java でいうと、定数をまとめた Config クラスのようなものです

export const AI_CONFIG = {
  /** 1つのAIを何ミリ秒待つか（120000 = 120秒）。過ぎたらあきらめて次のAIへ */
  timeoutMs: 120_000,

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
      model: "minimaxai/minimax-m3.1-flash",
      maxChars: 30000,
      apiKeyEnv: "NVIDIA_API_KEY",
    },
    {
      name: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.8-flash",
      maxChars: 100000,
      apiKeyEnv: "GEMINI_API_KEY",
    },
  ],
};