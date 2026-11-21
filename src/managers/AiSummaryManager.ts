// AiSummaryManager（Entity Manager／フロントエンド）：AIでノートをまとめる流れを担当する
// 
// AIへの送信は services/ai.ts（JWT を付けて ApiController に HTTP で頼む）を使う
//
// 【このファイルで何が起きているか】
// 「AIでまとめる」の流れを進める係です（Manager）。G007 の画面で使う予定。
// 1. summarize：送る内容をAIに渡し、「この枠にこう書いたら？」という提案（Suggestion）を受け取る
// 2. 学生が提案を直したり、使う・使わないを選んだりする（editSuggestion・setApproved）
// 3. applyApproved：使うと決めた提案だけを NoteManager に渡して、ノートに書き込む
import { Suggestion } from "../beans/Suggestion";
import type { SendContent } from "../beans/SendContent";
import type { Note } from "../beans/Note";
import { PartType } from "../enums/PartType";
import type { FrameType } from "../types";
import { organize } from "../services/ai";
import type { SendContentManager } from "./SendContentManager";

/** NoteManager のうち、AiSummaryManager が使う部分（W2 で東の NoteManager を渡す） */
export interface SuggestionApplier {
  applySuggestions(noteId: string, suggestions: Suggestion[]): Promise<void>;
  /** 保存せずに、提案を入れたノートを返す */
  mergeSuggestions(note: Note, suggestions: Suggestion[]): Note;
}

export class AiSummaryManager {
  constructor(private readonly sendContentManager: SendContentManager, private noteManager: SuggestionApplier | null = null) {}

  /** NoteManager ができたらここで渡す */
  setNoteManager(nm: SuggestionApplier) { this.noteManager = nm; }

  /**
   * AIに送り、枠の種類ごとに振り分けた提案のリストを受け取る。
   * 1万文字を超えるときは SendContentManager の split() で分けて送る。同じ種類の既存の枠があれば、その枠の書き換えとして提案される
   */
  async summarize(content: SendContent, note: Note, frameTypes: FrameType[]): Promise<Suggestion[]> {
    const frames = note.parts.filter(p => p.partType === PartType.FRAME).map(p => ({ id: p.partId, ft: (p.frameType ?? undefined) as FrameType | undefined }));
    const all: Suggestion[] = [];
    for (const chunk of this.sendContentManager.split(content)) {
      const proposals = await organize(chunk, frameTypes, frames);
      for (const p of proposals) {
        const text = p.ft === "word" ? (p.words ?? []).map(w => `${w.term}：${w.meaning}`).join("\n") : p.text;
        const same = all.find(s => s.frameType === p.ft && s.targetPartId === (p.targetId ?? null));
        if (same) same.content = `${same.content}\n${text}`; // 分けて送ったときは、同じ枠への提案を1つにまとめる
        else all.push(new Suggestion({ targetPartId: p.targetId ?? null, frameType: p.ft, content: text, approved: true }));
      }
    }
    return all;
  }

  /** 送った後、AIの提案の中身を学生が編集する */
  editSuggestion(suggestion: Suggestion, content: string): Suggestion { return new Suggestion({ ...suggestion, content }); }

  /** 提案ごとに承認するかを決める */
  setApproved(suggestion: Suggestion, approved: boolean): Suggestion { return new Suggestion({ ...suggestion, approved }); }

  /**
   * 承認した提案だけを入れたノートを返す（保存はしない）。G007 の「承認」で使う。
   * 画面ではこれを下書きにして、学習画面の「保存」を押したときに本当に保存する（勝手に保存しないため）
   */
  mergeApproved(note: Note, suggestions: Suggestion[]): Note {
    if (!this.noteManager) throw new Error("NoteManager がまだつながっていません");
    return this.noteManager.mergeSuggestions(note, suggestions.filter(s => s.approved));
  }

  /** 承認した提案だけを NoteManager の applySuggestions() でノートに反映し、残りは捨てる。反映した数を返す */
  async applyApproved(noteId: string, suggestions: Suggestion[]): Promise<number> {
    const ok = suggestions.filter(s => s.approved);
    if (ok.length) {
      if (!this.noteManager) throw new Error("NoteManager がまだつながっていません");
      await this.noteManager.applySuggestions(noteId, ok);
    }
    return ok.length;
  }
}