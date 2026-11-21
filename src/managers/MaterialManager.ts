// MaterialManager（Entity Manager／フロントエンド）：講義資料と文字起こしを管理する
// 担当：（11/21）。資料と文字起こしは端末（IndexedDB）だけに保存し、Neon には送らない（同期しない）
//
// 【このファイルで何が起きているか】
// 資料の「追加・文字起こし・見る・直す・消す」の確認係です（Manager）。
// 例：「＋ 資料の追加」→ Controller（G004:uploadMaterial）→ upload
//   1. 種類（画像・PDF・テキスト）と大きさ（20MBまで）を確認
//   2. MaterialDAO で端末に保存
//   続けて Controller（G004:transcribe）→ transcribe
//   3. 画像・PDF なら文字を読み取り（services/ocr.ts）、「資料名.txt」として保存（同じ名前があれば「資料名(2).txt」）
//   4. 進み具合は ProgressListener の onProgress(パーセント) で画面に知らせる
// テキストファイルは .txt を作らず、そのまま文字起こしとして使う
// 11/21 道B：画面も beans の Material をそのまま使うので、画面の形への変換（toScreenMaterial）はなくした
import { Material } from "../beans/Material";
import { now } from "../beans/DateTime";
import type { MaterialDAO } from "../dao/MaterialDAO";
import type { ProgressListener } from "../interfaces/ProgressListener";
import { transcribe as readText, type OcrResult } from "../services/ocr";
import { MAX_FILE, txtName } from "../lib/logic";
import { AppError, newId } from "./common";

/** 画面に出す文を持ったエラー */
export class MaterialError extends AppError {}

/** 端末に保存する。失敗したら（ほとんどは容量不足）画面に出す文のエラーにする */
async function saveOrFail(save: () => Promise<void>): Promise<void> {
  try { await save(); } catch { throw new MaterialError("保存容量が足りません"); }
}

/** 文字起こしの結果。transcript は文字起こし（.txt）の資料、failedPages は読み取れなかったページの番号 */
export interface TranscribeResult { transcript: Material; failedPages: number[] }

export class MaterialManager {
  /**
   * @param readTextFn 文字を読み取る関数（ふだんは services/ocr.ts の transcribe。動作確認のときに差し替えられるようにしてある）
   */
  constructor(
    private readonly materialDAO: MaterialDAO,
    private readonly readTextFn: (file: File, kind: "image" | "pdf", onProgress: (pct: number) => void) => Promise<OcrResult> = readText,
  ) {}

  /** その学習項目のストレージにある資料の一覧を返す（追加した順） */
  async getMaterials(itemId: string): Promise<Material[]> {
    return this.materialDAO.findByItem(itemId);
  }

  /**
   * 資料を追加する（画像・PDF・テキスト、1件20MBまで）。文字起こしはしない（続けて transcribe を呼ぶ）
   * テキストファイルは中身を文字として保存する（そのまま文字起こしとして使うため）
   */
  async upload(itemId: string, file: File): Promise<Material> {
    if (!itemId) throw new MaterialError("学習項目を選んでください");
    const fileType = MaterialManager.typeOf(file);
    if (!fileType) throw new MaterialError("取り込めない形式です（画像・PDF・テキストだけ）");
    if (file.size > MAX_FILE) throw new MaterialError("ファイルが大きすぎます（1件20MBまで）");
    const material = new Material({ materialId: newId(), itemId, fileName: file.name, fileType, fileSize: file.size, sourceMaterialId: null, addedAt: now() });
    const content = fileType === "text" ? await file.text() : file;
    await saveOrFail(() => this.materialDAO.insert(material, content));
    return material;
  }

  /**
   * 資料から文字を読み取り、「資料名.txt」を作る（同じ名前があれば「資料名(2).txt」）。
   * 進むたびに listener.onProgress(0〜100) を呼ぶ。テキストファイルは .txt を作らず、その資料をそのまま返す
   */
  async transcribe(materialId: string, listener: ProgressListener): Promise<TranscribeResult> {
    const src = await this.materialDAO.findById(materialId);
    if (!src) throw new MaterialError("資料が見つかりません");
    if (src.fileType === "text" || src.fileType === "transcript") return { transcript: src, failedPages: [] };
    const content = await this.materialDAO.findContent(materialId);
    if (!(content instanceof Blob)) throw new MaterialError("資料の中身が見つかりません。もう一度アップロードしてください");

    let result: OcrResult;
    try {
      result = await this.readTextFn(new File([content], src.fileName, { type: content.type }), src.fileType as "image" | "pdf", p => listener.onProgress(p));
    } catch {
      throw new MaterialError("文字起こしに失敗しました。自分で文字を入力するか、もう一度アップロードしてください");
    }

    const names = (await this.materialDAO.findByItem(src.itemId)).map(m => m.fileName);
    const transcript = new Material({
      materialId: newId(), itemId: src.itemId, fileName: txtName(src.fileName.replace(/\.[^.]+$/, ""), names),
      fileType: "transcript", fileSize: 0, sourceMaterialId: src.materialId, addedAt: now(),
    });
    await saveOrFail(() => this.materialDAO.insert(transcript, result.text)); // fileSize は DAO が中身から数える
    return { transcript: (await this.materialDAO.findById(transcript.materialId)) ?? transcript, failedPages: result.failedPages };
  }

  /** 資料の中身を返す（画像・PDF は Blob、テキスト・文字起こしは文字列。この端末になければ null） */
  async getContent(materialId: string): Promise<Blob | string | null> {
    return this.materialDAO.findContent(materialId);
  }

  /** 文字起こしの修正を保存する（G006 の「確定」） */
  async correctTranscript(materialId: string, text: string): Promise<void> {
    const m = await this.materialDAO.findById(materialId);
    if (!m) throw new MaterialError("資料が見つかりません");
    if (m.fileType !== "transcript" && m.fileType !== "text") throw new MaterialError("直せるのは文字起こしだけです");
    await saveOrFail(() => this.materialDAO.updateText(materialId, text));
  }

  /**
   * 資料を削除する。withTranscript が true なら、この資料から作った文字起こし（.txt）も一緒に消す。
   * false なら .txt は残る（元の資料がないことは、文字起こし修正画面に表示される）
   */
  async delete(materialId: string, withTranscript: boolean): Promise<void> {
    const m = await this.materialDAO.findById(materialId);
    if (!m) return; // もう消えている
    if (withTranscript) {
      for (const t of await this.materialDAO.findByItem(m.itemId)) if (t.sourceMaterialId === materialId) await this.materialDAO.delete(t.materialId);
    }
    await this.materialDAO.delete(materialId);
  }

  /** ファイルの種類を見分ける（取り込めない形式なら null） */
  static typeOf(file: File): "image" | "pdf" | "text" | null {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (file.type.startsWith("image/")) return "image";
    if (file.type === "application/pdf" || ext === "pdf") return "pdf";
    if (file.type.startsWith("text/") || ext === "txt") return "text";
    return null;
  }
}
