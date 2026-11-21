// 文字起こし（src/services/ocr.ts）で使うファイルを、node_modules から public/ocr/ に写す
//
// 【このファイルで何が起きているか】
// tesseract.js と PDF.js は、動くときに「本体のプログラム」「日本語の学習データ」などを別のファイルとして読みに行く。
// それらを jsDelivr（外部の配信サービス）から取ると学校のネットワークでブロックされることがあるので、
// 自分のサイト（Render の Static Site や、学校のサーバー）から配れるように public/ocr/ に置く。
// public/ に置いたものは、Vite がそのまま dist/ に写すので、ビルドした dist/ だけでどこでも動く
//
// いつ動くか：npm run dev と npm run build の直前に自動で動く（package.json の predev・prebuild）
// public/ocr/ は node_modules から毎回作り直せるので Git には入れない（.gitignore に書いてある）
// 写す先は public/ocr/<版の名前>/（例：public/ocr/tesseract7.0.0-pdfjs6.5.438/）。版の名前は scripts/ocr-version.mjs で決める
// tesseract.js・pdfjs-dist を新しい版にしたときも、npm install のあと dev か build をすれば新しい版のフォルダに作り直される
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { ocrVersion } from "./ocr-version.mjs";

const version = ocrVersion();
const from = p => new URL(`../node_modules/${p}`, import.meta.url);
const to = p => new URL(`../public/ocr/${version}/${p}`, import.meta.url);

rmSync(new URL("../public/ocr/", import.meta.url), { recursive: true, force: true }); // 古い版のファイルが残らないよう、いったん空にする
for (const dir of ["tesseract", "tesseract-core", "lang", "pdfjs"]) mkdirSync(to(dir), { recursive: true });

// ---- tesseract.js ----
// 作業員（Web Worker）のプログラム
cpSync(from("tesseract.js/dist/worker.min.js"), to("tesseract/worker.min.js"));
// 本体（wasm）。ブラウザの性能に合わせて、この3つのうち1つだけが読まれる（LSTM＝今の読み取り方式専用の軽い版）
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"])
  cpSync(from(`tesseract.js-core/${f}`), to(`tesseract-core/${f}`));
// 学習データ（日本語・英語）。LSTM 専用の軽い版（4.0.0_best_int）
for (const lang of ["jpn", "eng"])
  cpSync(from(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), to(`lang/${lang}.traineddata.gz`));

// ---- PDF.js ----
// cmaps：日本語などの文字を正しく取り出すための表。standard_fonts・wasm：一部の PDF を読むのに使う
for (const dir of ["cmaps", "standard_fonts", "wasm"])
  cpSync(from(`pdfjs-dist/${dir}`), to(`pdfjs/${dir}`), { recursive: true });

console.log(`文字起こし用のファイルを public/ocr/${version}/ に用意しました`);
