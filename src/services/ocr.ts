// 文字起こし（OCR）：画像・PDF から文字を読み取る。すべてブラウザの中で行い、サーバーには送らない（10/17 決定）
//
// 【このファイルで何が起きているか】
// ・画像：Tesseract.js（写真の中の文字を読む部品）で読む
// ・PDF ：PDF.js（PDF を開く部品）で1ページずつ開く
//         - 文字のデータが入っているページ（Word や PowerPoint から作った PDF）は、その文字をそのまま取り出す（速くて正確）
//         - 文字のデータがないページ（スキャンした PDF など）は、いったん画像にしてから Tesseract.js で読む
// ・進み具合（0〜100%）を onProgress で画面に知らせる（Java の ActionListener のように、画面から渡された関数を呼ぶだけ）
// ・読み取れなかったページは failedPages に番号を入れて返す。画面が「読み取れなかったページがあります」と出し、「修正」で直してもらう
//
// 部品は、文字起こしをするときだけ読み込む（import() で後から読む）。アプリを開いたときの画面を重くしないため
// Tesseract.js の本体・日本語の学習データと、PDF.js の日本語用の表（cmaps）は、自分のサイトの /ocr/ から取ってくる
//   ・外部の配信サービス（jsDelivr）は使わない（学校のネットワークでブロックされることがあるため）
//   ・/ocr/ のファイルは scripts/copy-ocr-files.mjs が node_modules から public/ocr/<版の名前>/ に写したもの（npm run dev・build で自動）
//   ・初回は合わせて約 9MB を読むので少し時間がかかり、その間は 0% のまま
//   ・2回目からはブラウザに保存したものを使うので、通信しない（学習データは Tesseract.js が IndexedDB に、それ以外は public/sw.js が保存する）
// PDF.js は「legacy 版」を使う。ふつうの版は最新のブラウザにしかない機能を使っていて、少し古い Chrome や Safari では PDF を開けないため
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface OcrResult { text: string; failedPages: number[] }

/** 読む言語。日本語と英語（講義資料には英単語も多いため） */
const LANG = "jpn+eng";
/** 取り出した文字がこれより少ないページは「文字のデータがない」とみなして、画像として読み直す */
const MIN_TEXT = 10;
/** PDF のページを画像にするときの拡大率。大きいほど正確に読めるが、遅くなる */
const SCALE = 2;
/**
 * 文字起こし用のファイルを置いた場所（例：https://runndesu.onrender.com/ocr/tesseract7.0.0-pdfjs6.5.438/）
 * どのサーバーに置いても、そのサーバーの /ocr/ を見る。__OCR_VERSION__ は vite.config.ts が入れる版の名前
 */
const OCR_FILES = new URL(`${import.meta.env.BASE_URL}ocr/${__OCR_VERSION__}/`, location.href).href;

/**
 * 資料から文字を読み取る（画面 Study.tsx の「資料の追加」から呼ばれる）
 * @param kind       資料の種類（画像か PDF か。テキストファイルは文字起こしをしないので来ない）
 * @param onProgress 進み具合（0〜100）を受け取る関数
 */
export async function transcribe(file: File, kind: "image" | "pdf", onProgress: (pct: number) => void): Promise<OcrResult> {
  onProgress(0);
  try {
    const r = kind === "image" ? await readImage(file, onProgress) : await readPdf(file, onProgress);
    onProgress(100);
    return r;
  } catch (e) {
    // 画面には「文字起こしに失敗しました」としか出ないので、本当の原因をブラウザのコンソールに残す（原因を調べるため）
    console.error("文字起こしに失敗しました（src/services/ocr.ts）:", e);
    throw e;
  }
}

// ---------- 画像 ----------
async function readImage(file: File, onProgress: (pct: number) => void): Promise<OcrResult> {
  const ocr = await openOcr();
  try {
    ocr.onRatio = r => onProgress(Math.round(r * 100));
    const text = tidy(await ocr.read(file));
    // 文字が1つも見つからなくても、空の .txt は作る（「修正」で自分で入力できるように）
    return { text, failedPages: text ? [] : [1] };
  } finally { await ocr.close().catch(() => {}); }
}

// ---------- PDF ----------
async function readPdf(file: File, onProgress: (pct: number) => void): Promise<OcrResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // PDF.js は重い処理を別の作業員（Web Worker）にやらせる。その作業員のファイルの場所を教える（作業員も legacy 版）
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  const files = OCR_FILES + "pdfjs/";
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: files + "cmaps/", cMapPacked: true, // 日本語の文字を正しく取り出すための表
    standardFontDataUrl: files + "standard_fonts/", wasmUrl: files + "wasm/",
  });
  const pdf = await task.promise;

  const pages: string[] = [], failedPages: number[] = [];
  let ocr: Ocr | null = null; // 画像として読むページが出てきたときだけ作る（作るのに時間がかかるため）
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      // 全体の進み具合 =（終わったページ数 + 今のページの進み具合）÷ 全ページ数
      const report = (r: number) => onProgress(Math.round(((n - 1 + r) / pdf.numPages) * 100));
      let page: PDFPageProxy | null = null, text = "";
      try {
        page = await pdf.getPage(n);
        text = await pageText(page);
        if (text.replace(/\s/g, "").length < MIN_TEXT) { // 文字のデータがほぼない → 画像にして読む
          ocr ??= await openOcr();
          ocr.onRatio = report;
          const read = await ocr.read(await pageImage(page));
          if (read.trim()) text = read;
        }
      } catch { /* このページは読めなかった（下で failedPages に入る） */ }
      text = tidy(text);
      if (!text) failedPages.push(n);
      pages.push(`【${n}ページ】\n${text}`);
      page?.cleanup();
      report(1);
    }
  } finally {
    // 後片づけ。ここで失敗しても、読み取った結果は返す
    await ocr?.close().catch(() => {});
    await task.destroy().catch(() => {}); // 開いた PDF を閉じて、メモリを空ける
  }
  return { text: pages.join("\n\n"), failedPages };
}

// ---------- 読み取った文字の後片づけ ----------
/** 日本語の文字（漢字・ひらがな・カタカナ・句読点など） */
const JA = "\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}ー々〆、。・「」『』（）！？：";
/** 日本語の文字と文字の間に入った空白を消す（Tesseract.js は日本語でも単語ごとに空白を入れてしまうため）。英語の単語の間の空白は残す */
const JA_SPACE = new RegExp(`(?<=[${JA}])[ \\t]+(?=[${JA}])`, "gu");
/** 部首用の文字（例：⼿）を、ふつうの漢字（例：手）に直す。PDF によっては見た目が同じ部首用の文字が入っていて、検索や AI がうまく扱えないため */
const RADICAL = /[\u2F00-\u2FDF]/gu;

function tidy(text: string): string {
  return text.replace(RADICAL, c => c.normalize("NFKC")).replace(JA_SPACE, "").trim();
}

/** PDF のページに入っている文字のデータを、そのまま取り出す */
async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  // items には「文字のかたまり」が並んでいる。hasEOL は「この後で改行する」という印
  return content.items.map(it => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
}

/** PDF のページを画像（canvas）に描く */
async function pageImage(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

// ---------- Tesseract.js（文字を読む部品）をまとめたもの ----------
interface Ocr {
  /** 今読んでいるものの進み具合（0〜1）を受け取る関数。読むものを変えるたびに差し替える */
  onRatio: (r: number) => void;
  read(image: File | HTMLCanvasElement): Promise<string>;
  close(): Promise<void>;
}

async function openOcr(): Promise<Ocr> {
  const { createWorker } = await import("tesseract.js");
  const ocr: Ocr = {
    onRatio: () => {},
    read: async image => (await worker.recognize(image)).data.text,
    close: async () => { await worker.terminate(); },
  };
  const worker = await createWorker(LANG, undefined, {
    // どこからファイルを取るか（書かないと jsDelivr から取ってしまう）
    workerPath: OCR_FILES + "tesseract/worker.min.js", // 作業員のプログラム
    corePath: OCR_FILES + "tesseract-core",            // 本体（ブラウザに合う1つを自動で選ぶ）
    langPath: OCR_FILES + "lang",                      // 学習データ（jpn・eng）
    // logger は Tesseract.js が「今ここまで進んだ」と知らせてくる窓口。文字を読んでいる最中の進み具合だけ使う
    logger: m => { if (m.status === "recognizing text") ocr.onRatio(m.progress); },
  });
  return ocr;
}
