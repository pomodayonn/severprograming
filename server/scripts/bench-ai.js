// bench-ai.js：AIごとに「ノートまとめ」を1回ずつ頼んで、何秒かかったか・使える返事だったかを測る（11/22）
//
// 【使い方】（server フォルダで）
//   node --env-file=.env scripts/bench-ai.js <テキストファイル> [AIの名前 ...]
//   例：node --env-file=.env scripts/bench-ai.js ~/Desktop/長いノート.txt
//   例：node --env-file=.env scripts/bench-ai.js ~/Desktop/長いノート.txt Gemini "NVIDIA NIM"
//   例：node --env-file=.env scripts/bench-ai.js ~/Desktop/長いノート.txt Gemini --model=gemini-3.5-flash-lite   （config.js を書き換えずに別のモデルを試す）
//   例：node --env-file=.env scripts/bench-ai.js ~/Desktop/長いノート.txt --chars=5000   （先頭から5000文字だけ送る。長さで速さが変わるか見る）
//
// 【このファイルで何が起きているか】
// 1. テキストファイルの先頭から1万文字（アプリが1回に送る分）を取り出し、本番と同じ buildOrganize でプロンプトを作る
// 2. AIを1つずつ順番に呼ぶ（同時には呼ばない）。待つ長さは本番と同じ config.js の timeoutMs
// 3. 返事を本番と同じ readOrganize で読み、何秒かかったか・枠がいくつ出たかを表示する
// ・アプリの利用回数（DB）は使わない。各AIの無料枠は1回ずつ使う
// ・AIの名前を省くと、config.js の providers を全部試す（文字数の上限を超えるAIは飛ばす）
import { readFileSync } from "node:fs";
import { AI_CONFIG } from "../src/config.js";
import { defaultProviders } from "../src/boundary/AiProvider.js";
import { buildOrganize, readOrganize, FRAME_TYPES, SEND_LIMIT } from "../src/service/AiPrompts.js";

const args = process.argv.slice(2);
const charsArg = args.find((a) => a.startsWith("--chars="));
const modelArg = args.find((a) => a.startsWith("--model="));
const chars = charsArg ? Number(charsArg.slice("--chars=".length)) : SEND_LIMIT;
const [file, ...names] = args.filter((a) => a !== charsArg && a !== modelArg);
if (!file) {
  console.log('使い方：node --env-file=.env scripts/bench-ai.js <テキストファイル> [AIの名前 ...]');
  process.exit(1);
}

if (!Number.isInteger(chars) || chars < 1 || chars > SEND_LIMIT) { console.log(`--chars は 1〜${SEND_LIMIT} の整数`); process.exit(1); }
const text = [...readFileSync(file, "utf8")].slice(0, chars).join("");
const frameTypes = Object.keys(FRAME_TYPES);
const prompt = buildOrganize(text, frameTypes);
const length = [...prompt].length;
const providers = defaultProviders().filter((p) => !names.length || names.includes(p.name));
if (modelArg) {
  if (providers.length !== 1) { console.log("--model を使うときは、AIの名前を1つだけ書いてください（例：Gemini --model=...）"); process.exit(1); }
  providers[0].model = modelArg.slice("--model=".length);
  providers[0].maxChars = Infinity; // 別のモデルは文字数の上限が違うことがあるので、ここでは確かめない
}
if (!providers.length) {
  console.log(`その名前のAIがありません。使える名前：${AI_CONFIG.providers.map((p) => `"${p.name}"`).join(" ")}`);
  process.exit(1);
}

console.log(`送る文章：${[...text].length}文字（プロンプト全体：${length}文字）／1つのAIを最大 ${AI_CONFIG.timeoutMs / 1000}秒 待つ\n`);
for (const p of providers) {
  if (!p.apiKey) { console.log(`- ${p.name}：APIキー（${p.apiKeyEnv}）がないので飛ばします`); continue; }
  if (!p.canAccept(length)) { console.log(`- ${p.name}：${p.maxChars}文字までなので飛ばします`); continue; }
  const start = Date.now();
  try {
    const reply = await p.send(prompt);
    const s = ((Date.now() - start) / 1000).toFixed(1);
    try {
      const proposals = readOrganize(reply, frameTypes, []);
      console.log(`- ${p.name}（${p.model}）：${s}秒 ○ 使える返事（枠 ${proposals.length}個）`);
    } catch (e) {
      console.log(`- ${p.name}（${p.model}）：${s}秒 × 返事の形がおかしい（${e.message}）`);
    }
  } catch (e) {
    const s = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`- ${p.name}（${p.model}）：${s}秒 × 失敗（${e instanceof Error ? e.message : e}）`);
  }
}
