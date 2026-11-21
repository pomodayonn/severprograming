// 文字起こし用ファイルの「版の名前」を決める（例：tesseract7.0.0-pdfjs6.5.438）
//
// 【このファイルで何が起きているか】
// 文字起こし用のファイルは public/ocr/<版の名前>/ に置き、ブラウザ（public/sw.js）が保存して使い回す。
// tesseract.js や pdfjs-dist を新しい版にすると、版の名前＝置き場所の URL も変わるので、
// ブラウザは保存した古いファイルを使わず、新しいファイルを取りに行く（古い版と新しい版が混ざって壊れるのを防ぐ）
// 使うところ：scripts/copy-ocr-files.mjs（どのフォルダに写すか）と vite.config.ts（ocr.ts にどの URL を見せるか）
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** node_modules に入っている部品の版を読む（npm のコマンドもVite も、プロジェクトのフォルダで動くので、そこからの場所で探す） */
const versionOf = name => JSON.parse(readFileSync(resolve("node_modules", name, "package.json"), "utf8")).version;

export const ocrVersion = () => `tesseract${versionOf("tesseract.js")}-pdfjs${versionOf("pdfjs-dist")}`;
