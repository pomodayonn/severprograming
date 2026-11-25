// NoteManager（Entity Manager／フロントエンド）：ノートを管理する
// 担当：（11/11）。「保存」ボタンで端末に保存し、SyncManager でアカウントにも送る（手動保存）
import { Note } from "../beans/Note";
import { NotePart } from "../beans/NotePart";
import { Word } from "../beans/Word";
import type { Suggestion } from "../beans/Suggestion";
import { PartType } from "../enums/PartType";
import type { FrameType } from "../types";
import { now } from "../beans/DateTime";
import { FT } from "../lib/logic";
import { textToWords } from "../lib/words";
import type { NoteDAO } from "../dao/NoteDAO";
import { newId, pushQuietly, type ChangePusher } from "./common";
import type { SuggestionApplier } from "./AiSummaryManager";
import { parseRich, stringifyRich } from "../lib/rich";

/**
 * SyncManager のうち、NoteManager が使う部分（11/24：ノートの食い違い、UC-018 代替フロー(2)）。
 * Java の interface と同じで、NoteManager は SyncManager の中身を知らなくても呼べる
 */
export interface NoteSyncer extends ChangePusher {
  keepMineNote(noteId: string): Promise<void>;
  takeRemoteNote(noteId: string): Promise<Note | null>;
}

/** 食い違ったときに、どちらのノートにするか。mine：この端末の内容で上書き、theirs：別の端末の内容にする */
export type ConflictChoice = "mine" | "theirs";

/** 目次の1行（右サイドバー用） */
export interface TocEntry { partId: string; kind: "heading" | "frame"; level: number; label: string; y: number }

/** 枠と枠のすき間 */
const GAP = 16;
/** 中身の量から枠の高さを決める（今の画面の AiSend.tsx と同じ計算） */
const heightFor = (frameType: string, content: string): number => {
  const lines = content.split("\n").filter(l => l.trim()).length || 1;
  return frameType === "word" ? Math.max(150, 90 + lines * 30) : Math.max(110, 50 + lines * 24);
};
/** 「用語：意味」の行を単語にする（区切り方は lib/words.ts の textToWords） */
const toWords = (content: string): Word[] => textToWords(content).map(w => new Word({ wordId: newId(), ...w }));
const frameName = (frameType: string | null) => (frameType && FT[frameType as FrameType]?.n) || "枠";

export class NoteManager implements SuggestionApplier {
  constructor(private readonly noteDAO: NoteDAO, private readonly syncManager: NoteSyncer | null = null) {}

  /** ノートを中の部品ごと返す。まだなければ空のノートを作る（学習項目を作る前のデータのため） */
  async getNote(itemId: string, studentId: string): Promise<Note> {
    return (await this.noteDAO.findByItem(itemId)) ?? this.noteDAO.insertEmpty(itemId, studentId);
  }

  /** 「保存」ボタン：端末に保存し、SyncManager でアカウントにも送る。保存したノートを返す */
  async saveNote(note: Note): Promise<Note> {
    const saved = await this.noteDAO.save(note);
    await this.sync();
    return saved;
  }

  /**
   * 食い違いを解決する（11/24、UC-018 代替フロー(2)）。食い違いの知らせは SyncManager から NoteConflictListener で画面に届く。
   * ・mine  ：「上書きして保存」。この端末のノートを保存し直して、アカウントに送る
   * ・theirs：「別の端末の内容にする」。アカウントのノートを受け取って、この端末のノートを置き換える（この端末の変更は捨てる）
   * 解決したあとのノートを返す
   */
  async resolveConflict(itemId: string, studentId: string, choice: ConflictChoice): Promise<Note> {
    const note = await this.getNote(itemId, studentId);
    if (!this.syncManager) return note;
    if (choice === "mine") {
      await this.syncManager.keepMineNote(note.noteId);
      return this.saveNote(note);
    }
    return (await this.syncManager.takeRemoteNote(note.noteId)) ?? note;
  }

  /**
   * 枠が大きくなって下の部品と重なりそうなとき、下の部品をまとめて下にずらす。
   * 保存はしない（画面の下書きに使う）。ずらした後のノートを返す
   */
  adjustOverlap(note: Note, partId: string): Note {
    const t = note.parts.find(p => p.partId === partId); if (!t) return note;
    const bottom = t.y + t.height;
    // 横に重なっていて、上の端が t の上の端より下にある部品
    const below = note.parts.filter(p => p.partId !== partId && p.y > t.y && p.x < t.x + t.width && t.x < p.x + p.width);
    if (!below.length) return note;
    const top = Math.min(...below.map(p => p.y));
    const d = bottom + GAP - top;
    if (d <= 0) return note;
    return new Note({ ...note, parts: note.parts.map(p => p.partId !== partId && p.y >= top ? new NotePart({ ...p, y: p.y + d, updatedAt: now() }) : p) });
  }

  /** 右サイドバーの目次用に、見出し（文字の見出し1〜3）と枠を上から順に返す */
  getTableOfContents(note: Note): TocEntry[] {
    return note.parts
      .filter(p => p.partType === PartType.FRAME || (p.partType === PartType.TEXT && p.headingLevel > 0))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map(p => p.partType === PartType.FRAME
        ? { partId: p.partId, kind: "frame" as const, level: 0, y: p.y, label: `${frameName(p.frameType)}　${(p.words[0]?.term ?? p.text).slice(0, 12)}` }
        : { partId: p.partId, kind: "heading" as const, level: p.headingLevel, y: p.y, label: `見出し${p.headingLevel}　${p.text.slice(0, 14)}` });
  }

  /**
   * 承認したAIの提案をノートに反映する（保存はしない）。既存の枠は位置そのままで中身を置き換え、
   * 大きくなったら下の部品をずらす。新しい枠はノートの一番下に置く。反映後のノートを返す
   */
  mergeSuggestions(note: Note, suggestions: Suggestion[]): Note {
    let n = new Note({ ...note, parts: [...note.parts] });
    for (const s of suggestions) {
      const h = heightFor(s.frameType, s.content);
      const target = s.targetPartId ? n.parts.find(p => p.partId === s.targetPartId) : undefined;
      if (target) {
        const changed = new NotePart({
          ...target, height: Math.max(target.height, h),
          text: s.frameType === "word" ? target.text : s.content,
          words: s.frameType === "word" ? toWords(s.content) : target.words,
          // 11/25 夜 バグ修正：文字が書きかわったら、文字ごとの書式は外す（前の書式の位置が、新しい文字とずれるため）。そろえ方は残す
          style: s.frameType === "word" || s.content === target.text ? target.style : stringifyRich({ align: parseRich(target.style).align, runs: [] }, s.content.length),
        });
        n = new Note({ ...n, parts: n.parts.map(p => p.partId === target.partId ? changed : p) });
        n = this.adjustOverlap(n, target.partId);
      } else {
        const y = n.parts.reduce((m, p) => Math.max(m, p.y + p.height), 0) + (n.parts.length ? 36 : 24);
        n.parts.push(new NotePart({
          partId: newId(), noteId: n.noteId, studentId: n.studentId, partType: PartType.FRAME, frameType: s.frameType,
          x: 24, y, width: 380, height: h, color: FT[s.frameType as FrameType]?.c ?? "#5a5670",
          text: s.frameType === "word" ? "" : s.content, words: s.frameType === "word" ? toWords(s.content) : [],
        }));
      }
    }
    return n;
  }

  /** 単語テスト用に、単語枠から用語と意味が両方入っている単語を取り出す（partIds を渡したら、その枠だけ。TestManager から呼ぶ） */
  async getWords(itemId: string, partIds?: string[]): Promise<Word[]> {
    const note = await this.noteDAO.findByItem(itemId);
    return (note?.parts ?? []).filter(p => p.partType === PartType.FRAME && p.frameType === "word" && (!partIds || partIds.includes(p.partId)))
      .flatMap(p => p.words).filter(w => w.term.trim() && w.meaning.trim());
  }

  /**
   * 画面の「保存」ボタン：画面で書いた部品（下書き）でノートの中身を置き換えて保存し、アカウントにも送る。
   * 11/21 道B：前は画面の形（El）から NotePart に変換していたが、今は画面も NotePart を使うので、そのまま保存する
   */
  async saveParts(studentId: string, itemId: string, parts: readonly NotePart[]): Promise<Note> {
    const note = await this.getNote(itemId, studentId);
    return this.saveNote(new Note({ ...note, parts: [...parts] }));
  }

  private sync() { return pushQuietly(this.syncManager); }
}