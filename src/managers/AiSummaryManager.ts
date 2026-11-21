// AiSummaryManager（Entity Manager／フロントエンド）：AIでノートをまとめる流れを担当する
// 
// AIへの送信は services/ai.ts（JWT を付けて ApiController に HTTP で頼む）を使う
//
// 【このファイルで何が起きているか】
// 「AIでまとめる」の流れを進める係です（Manager）。G007 の画面で使う。
// 1. summarize：送る内容をAIに渡し、「この枠にこう書いたら？」という提案（Suggestion）を受け取る
// 2. 学生が画面で提案を直したり、使う・使わないを選んだりする（画面の中だけで行う）
// 3. mergeApproved：使うと決めた提案だけを NoteManager に渡して、提案を入れたノートを返す。
//    保存はしない（「ノートは保存ボタンを押したときだけ保存」の決まりのため）
import { Suggestion } from "../beans/Suggestion";
import type { SendContent } from "../beans/SendContent";
import type { Note } from "../beans/Note";
import { PartType } from "../enums/PartType";
import type { FrameType } from "../types";
import { organize } from "../services/ai";
import { wordsToText } from "../lib/words";
import type { SendContentManager } from "./SendContentManager";

/** NoteManager のうち、AiSummaryManager が使う部分 */
export interface SuggestionApplier {
  /** 保存せずに、提案を入れたノートを返す */
  mergeSuggestions(note: Note, suggestions: Suggestion[]): Note;
}

export class AiSummaryManager {
  constructor(private readonly sendContentManager: SendContentManager, private readonly noteManager: SuggestionApplier) {}

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
        const text = p.ft === "word" ? wordsToText(p.words ?? []) : p.text;
        const same = all.find(s => s.frameType === p.ft && s.targetPartId === (p.targetId ?? null));
        if (same) same.content = `${same.content}\n${text}`; // 分けて送ったときは、同じ枠への提案を1つにまとめる
        else all.push(new Suggestion({ targetPartId: p.targetId ?? null, frameType: p.ft, content: text, approved: true }));
      }
    }
    return all;
  }

  /**
   * 承認した提案だけを入れたノートを返す（保存はしない）。G007 の「承認」で使う。
   * 画面ではこれを下書きにして、学習画面の「保存」を押したときに本当に保存する（勝手に保存しないため）
   */
  mergeApproved(note: Note, suggestions: Suggestion[]): Note {
    return this.noteManager.mergeSuggestions(note, suggestions.filter(s => s.approved));
  }
}