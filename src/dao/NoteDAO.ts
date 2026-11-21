// NoteDAO（DAO／フロントエンド）：ノートを部品・単語ごと端末（IndexedDB）に保存・読み込みする
// 担当
//
// 【このファイルで何が起きているか】
// ノート（中の部品・単語ごと1件にまとめて）を、端末の IndexedDB（dao/idb.ts）に保存したり読み出したりする係（DAO）です。
// DAO は「しまう・取り出す」だけをして、名前が正しいかなどの確認は Manager（NoteManager）がする。
// 流れ：画面 → Controller → NoteManager → ここ → IndexedDB
// 保存すると updatedAt（更新日時）が新しくなり、SyncManager がそれを見て Neon（クラウド）に送る
// Neon では note・note_part・word の3つの表に分かれるが、端末ではノート1件の中に全部入れておく
import { Note } from "../beans/Note";
import { NotePart } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { now } from "../beans/DateTime";
import { del, get, getAllBy, put } from "./idb";
import { newId } from "../lib/logic";

/** 保存しておいた形から、ノート・部品・単語の beans に戻す */
const toNote = (r: Note): Note => new Note({ ...r, parts: (r.parts ?? []).map(p => new NotePart({ ...p, words: (p.words ?? []).map(w => new Word(w)) })) });

export class NoteDAO {
  /** その学習項目のノートを読み込む（なければ null） */
  async findByItem(itemId: string): Promise<Note | null> {
    const [r] = await getAllBy<Note>("notes", "itemId", itemId);
    return r ? toNote(r) : null;
  }
  /** ノートIDでノートを読み込む（なければ null）。AIの提案を反映するときに使う */
  async findById(noteId: string): Promise<Note | null> {
    const r = await get<Note>("notes", noteId);
    return r ? toNote(r) : null;
  }
  /** 学習項目を作ったときに、空のノートを作る */
  async insertEmpty(itemId: string, studentId: string): Promise<Note> {
    const n = new Note({ noteId: newId(), studentId, itemId, lastSavedAt: null, parts: [], updatedAt: now() });
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