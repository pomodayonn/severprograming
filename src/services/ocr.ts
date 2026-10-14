// 文字の読み取り。実装時は Tesseract.js か画像対応AIに置き換える。confidence < 0.8 のときは画面で撮り直し等を案内する。
export interface OCR { read(images: string[]): Promise<{ text: string; confidence: number }> }
export const ocr: OCR = { async read() { await new Promise(r => setTimeout(r, 600)); return { text: "", confidence: 0 }; } };
