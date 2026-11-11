// NoteDAO（DAO／フロントエンド）：ノートを部品・単語ごと端末（IndexedDB）に保存・読み込みする
// 担当
import { Note } from "../beans/Note";
import { NotePart } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { now } from "../beans/DateTime";
import { del, getAllBy, put } from "./idb";

/** 保存しておいた形から、ノート・部品・単語の beans に戻す */
const toNote = (r: Note): Note => new Note({ ...r, parts: (r.parts ?? []).map(p => new NotePart({ ...p, words: (p.words ?? []).map(w => new Word(w)) })) });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class NoteDAO {
  /** その学習項目のノートを読み込む（なければ null） */
  async findByItem(itemId: string): Promise<Note | null> {
    const [r] = await getAllBy<Note>("notes", "itemId", itemId);
    return r ? toNote(r) : null;
  }
  /** 学習項目を作ったときに、空のノートを作る */
  async insertEmpty(itemId: string, studentId: string): Promise<Note> {
    const n = new Note({ noteId: uid(), studentId, itemId, lastSavedAt: null, parts: [], updatedAt: now() });
    await put("notes", n); return n;
  }
  /** ノートを部品・単語ごと保存する（「保存」ボタン）。部品・単語には学生IDとノートIDを入れる */
  async save(note: Note): Promise<Note> {
    const t = now();
    const n = new Note({
      ...note, lastSavedAt: t, updatedAt: t,
      parts: note.parts.map(p => new NotePart({ ...p, studentId: note.studentId, noteId: note.noteId, updatedAt: p.updatedAt || t,
        words: p.words.map(w => new Word({ ...w, studentId: note.studentId, partId: p.partId, updatedAt: w.updatedAt || t })) })),
    });
    await put("notes", n); return n;
  }
  /** 学習項目を消すときに、そのノートを端末から消す（Neon では学習項目と一緒に消える） */
  async deleteByItem(itemId: string): Promise<void> {
    const [r] = await getAllBy<Note>("notes", "itemId", itemId);
    if (r) await del("notes", r.noteId);
  }
}