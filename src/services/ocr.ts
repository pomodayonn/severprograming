// 文字起こし。いまは仮実装（実装時：Tesseract.js / PDF.js / 画像対応AI に差し替える）。
export interface OcrResult { text: string; failedPages: number[] }
export async function transcribe(file: File, kind: "image" | "pdf", onProgress: (pct: number) => void): Promise<OcrResult> {
  for (let p = 10; p <= 100; p += 30) { onProgress(Math.min(p, 100)); await new Promise(r => setTimeout(r, 250)); }
  return { text: `（${file.name} の文字起こし）\n※試作：文字の読み取りは未接続のため、この文章は仮です。「修正」で正しい文字に直してください。`, failedPages: kind === "pdf" ? [] : [] };
}
