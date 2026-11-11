// SyncManager（Entity Manager／フロントエンド）：端末（IndexedDB）とアカウント（Neon）のデータをそろえる
// 担
//
// ・Neon の Data API（PostgREST の形）を、ログインの JWT を付けて HTTP で直接呼ぶ（Render のサーバーは通さない）
// ・どの行を読み書きできるかは、Neon の RLS が JWT の学生IDで決める（db/rls.sql）
// ・.env に VITE_NEON_DATA_API_URL がなければ何もしない（端末だけで動く）
// ・資料と文字起こしは端末だけなので、同期しない
import { Subject } from "../beans/Subject";
import { LearningItem } from "../beans/LearningItem";
import { Prerequisite } from "../beans/Prerequisite";
import { Note } from "../beans/Note";
import { NotePart } from "../beans/NotePart";
import { Word } from "../beans/Word";
import { Test } from "../beans/Test";
import { Question } from "../beans/Question";
import { Attempt } from "../beans/Attempt";
import { Answer } from "../beans/Answer";
import { now } from "../beans/DateTime";
import type { PartType } from "../enums/PartType";
import type { TestType } from "../enums/TestType";
import type { NeonAuthClient } from "../boundary/NeonAuthClient";
import { del, get, getAll, getAllBy, put, putMany, type Deletion } from "../dao/idb";

type Row = Record<string, unknown>;
export class SyncError extends Error {}

export class SyncManager {
  /** 前回同期した日時（学生ごとに端末に保存する） */
  lastSyncedAt: string | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly authClient: NeonAuthClient, private readonly dataApiUrl: string | undefined = import.meta.env.VITE_NEON_DATA_API_URL) {}

  /** 同期できる状態か（Data API の URL があり、ログインしている） */
  get enabled(): boolean { return !!this.dataApiUrl && this.authClient.neon; }

  /**
   * ログインしたときに、科目・学習項目・前提項目・ノート・テストをアカウントから受け取り、端末に保存する（AccountManager から呼ぶ）。
   * 端末にまだ送っていない変更があれば、先に送ってから受け取る（端末の変更が消えないように）
   */
  async pullAll(): Promise<void> {
    if (!this.enabled) return;
    const student = await this.authClient.getSession(); if (!student) return;
    await this.pushChanges();
    const [subjects, items, prereqs, notes, parts, words, tests, questions, attempts, answers] = await Promise.all(
      ["subject", "learning_item", "prerequisite", "note", "note_part", "word", "test", "question", "attempt", "answer"].map(t => this.select(t)));
    // ---- Neon の形（スネークケース・別々のテーブル）から、端末の形（beans・入れ子）に戻す ----
    const wordsBy = group(words, "part_id"), partsBy = group(parts, "note_id");
    const qBy = group(questions, "test_id"), aBy = group(attempts, "test_id"), ansBy = group(answers, "attempt_id");
    const sid = student.id;
    const sub = subjects.map(r => new Subject({ subjectId: s(r.subject_id), studentId: sid, subjectName: s(r.subject_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const its = items.map(r => new LearningItem({ itemId: s(r.item_id), studentId: sid, subjectId: s(r.subject_id), itemName: s(r.item_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const pres = prereqs.map(r => new Prerequisite({ studentId: sid, itemId: s(r.item_id), prereqItemId: s(r.prereq_item_id), updatedAt: s(r.updated_at) }));
    const nts = notes.map(r => new Note({
      noteId: s(r.note_id), studentId: sid, itemId: s(r.item_id), lastSavedAt: n(r.last_saved_at), updatedAt: s(r.updated_at),
      parts: (partsBy[s(r.note_id)] ?? []).map(p => new NotePart({
        partId: s(p.part_id), studentId: sid, noteId: s(p.note_id), partType: s(p.part_type) as PartType, frameType: n(p.frame_type),
        x: num(p.x), y: num(p.y), width: num(p.width), height: num(p.height), color: s(p.color), text: s(p.text), headingLevel: num(p.heading_level), updatedAt: s(p.updated_at),
        words: (wordsBy[s(p.part_id)] ?? []).map(w => new Word({ wordId: s(w.word_id), studentId: sid, partId: s(w.part_id), term: s(w.term), meaning: s(w.meaning), updatedAt: s(w.updated_at) })),
      })),
    }));
    const tss = tests.map(r => new Test({
      testId: s(r.test_id), studentId: sid, itemId: s(r.item_id), testType: s(r.test_type) as TestType, questionCount: num(r.question_count),
      createdAt: s(r.created_at), lastTakenAt: n(r.last_taken_at), updatedAt: s(r.updated_at),
      questions: (qBy[s(r.test_id)] ?? []).map(q => new Question({ questionId: s(q.question_id), studentId: sid, testId: s(q.test_id), number: num(q.number), questionText: s(q.question_text), modelAnswer: s(q.model_answer), explanation: n(q.explanation), updatedAt: s(q.updated_at) })).sort((a, b) => a.number - b.number),
      attempts: (aBy[s(r.test_id)] ?? []).map(a => new Attempt({
        attemptId: s(a.attempt_id), studentId: sid, testId: s(a.test_id), attemptNo: num(a.attempt_no), takenAt: s(a.taken_at), updatedAt: s(a.updated_at),
        answers: (ansBy[s(a.attempt_id)] ?? []).map(x => new Answer({ answerId: s(x.answer_id), studentId: sid, attemptId: s(x.attempt_id), questionId: s(x.question_id), studentAnswer: s(x.student_answer), correct: x.correct === null || x.correct === undefined ? null : !!x.correct, answeredAt: s(x.answered_at), updatedAt: s(x.updated_at) })),
      })).sort((a, b) => a.attemptNo - b.attemptNo),
    }));
    // ---- 端末のこの学生のデータを、受け取った内容に置き換える ----
    await this.clearLocal(sid);
    await putMany("subjects", sub); await putMany("learningItems", its); await putMany("prerequisites", pres);
    await putMany("notes", nts); await putMany("tests", tss);
    await this.setLastSynced(sid, now());
  }

  /**
   * 前回の同期より後に変わったデータ（updatedAt が新しいもの）と、消したデータだけをアカウントに送る。
   * SubjectManager・LearningItemManager・NoteManager・TestManager が保存したあとに呼ぶ。同時に呼ばれても1回ずつ順に送る
   */
  async pushChanges(): Promise<void> {
    if (!this.enabled) return;
    const prev = this.running ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.push());
    this.running = run.finally(() => { if (this.running === run) this.running = null; });
    return run;
  }

  // ======================= ここから private =======================
  private async push(): Promise<void> {
    const student = await this.authClient.getSession(); if (!student) return;
    const sid = student.id, since = await this.getLastSynced(sid), started = now();
    const newer = <T extends { updatedAt: string; studentId: string }>(rows: T[]) => rows.filter(r => r.studentId === sid && (!since || r.updatedAt > since));

    // 1) 削除を先に送る（同じIDで作り直した場合に、あとの追加が消されないように）
    const dels = (await getAllBy<Deletion>("deletions", "studentId", sid)).sort((a, b) => a.at.localeCompare(b.at));
    for (const d of dels) {
      const filter = d.table === "prerequisite"
        ? `item_id=eq.${enc(d.key.split("|")[0])}&prereq_item_id=eq.${enc(d.key.split("|")[1])}`
        : `${KEY[d.table]}=eq.${enc(d.key)}`;
      await this.request("DELETE", `/${d.table}?${filter}`);
      await del("deletions", [d.table, d.key]);
    }
    // 2) 親から順に送る（外部キーがあるので、科目 → 学習項目 → 前提項目・ノート・テスト の順）
    const subjects = newer(await getAll<Subject>("subjects"));
    await this.upsert("subject", subjects.map(x => ({ subject_id: x.subjectId, subject_name: x.subjectName, created_at: x.createdAt })));
    const items = newer(await getAll<LearningItem>("learningItems"));
    await this.upsert("learning_item", items.map(x => ({ item_id: x.itemId, subject_id: x.subjectId, item_name: x.itemName, created_at: x.createdAt })));
    const prereqs = newer(await getAll<Prerequisite>("prerequisites"));
    await this.upsert("prerequisite", prereqs.map(x => ({ item_id: x.itemId, prereq_item_id: x.prereqItemId })), "item_id,prereq_item_id");

    // ノート：変わったノートは、部品と単語を丸ごと送り直す（消した部品は Neon からも消す）
    for (const note of newer(await getAll<Note>("notes"))) {
      await this.upsert("note", [{ note_id: note.noteId, item_id: note.itemId, last_saved_at: note.lastSavedAt }]);
      const ids = note.parts.map(p => p.partId);
      await this.request("DELETE", `/note_part?note_id=eq.${enc(note.noteId)}${ids.length ? `&part_id=not.in.(${ids.map(quote).join(",")})` : ""}`);
      await this.upsert("note_part", note.parts.map(p => ({ part_id: p.partId, note_id: note.noteId, part_type: p.partType, frame_type: p.frameType, x: Math.round(p.x), y: Math.round(p.y), width: Math.max(1, Math.round(p.width)), height: Math.max(1, Math.round(p.height)), color: p.color, text: p.text, heading_level: p.headingLevel })));
      for (const p of note.parts) {
        const wids = p.words.map(w => w.wordId);
        await this.request("DELETE", `/word?part_id=eq.${enc(p.partId)}${wids.length ? `&word_id=not.in.(${wids.map(quote).join(",")})` : ""}`);
      }
      await this.upsert("word", note.parts.flatMap(p => p.words.map(w => ({ word_id: w.wordId, part_id: p.partId, term: w.term, meaning: w.meaning }))));
    }
    // テスト：変わったテストは、問題・受験・解答を丸ごと送り直す
    for (const t of newer(await getAll<Test>("tests"))) {
      await this.upsert("test", [{ test_id: t.testId, item_id: t.itemId, test_type: t.testType, question_count: Math.max(1, t.questions.length), created_at: t.createdAt, last_taken_at: t.lastTakenAt }]);
      await this.upsert("question", t.questions.map(q => ({ question_id: q.questionId, test_id: t.testId, number: q.number, question_text: q.questionText, model_answer: q.modelAnswer, explanation: q.explanation })));
      await this.upsert("attempt", t.attempts.map(a => ({ attempt_id: a.attemptId, test_id: t.testId, attempt_no: a.attemptNo, taken_at: a.takenAt })));
      await this.upsert("answer", t.attempts.flatMap(a => a.answers.map(x => ({ answer_id: x.answerId, attempt_id: a.attemptId, question_id: x.questionId, student_answer: x.studentAnswer, correct: x.correct, answered_at: x.answeredAt }))));
    }
    await this.setLastSynced(sid, started); // 送っている間に変わったものは次回送る
  }

  /** そのテーブルの自分の行を全部受け取る（RLS で自分の行だけが返る） */
  private async select(table: string): Promise<Row[]> {
    return (await this.request("GET", `/${table}?select=*`)) as Row[];
  }
  /** なければ追加、あれば更新する。student_id と updated_at は Neon が入れる */
  private async upsert(table: string, rows: Row[], onConflict?: string): Promise<void> {
    if (!rows.length) return;
    await this.request("POST", `/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`, rows, "resolution=merge-duplicates,return=minimal");
  }
  private async request(method: string, path: string, body?: unknown, prefer?: string): Promise<unknown> {
    const token = await this.authClient.getAccessToken();
    if (!token) throw new SyncError("ログインしていないため同期できません");
    let res: Response;
    try {
      res = await fetch(this.dataApiUrl!.replace(/\/$/, "") + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new SyncError("通信できないため同期できませんでした（端末には保存されています）"); }
    if (!res.ok) throw new SyncError(`同期に失敗しました（${res.status}）`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  /** 端末にあるこの学生の同期データを消す（受け取り直す前に） */
  private async clearLocal(sid: string): Promise<void> {
    for (const [store, key] of [["subjects", "subjectId"], ["learningItems", "itemId"], ["notes", "noteId"], ["tests", "testId"]] as const) {
      for (const r of await getAllBy<Row>(store, "studentId", sid)) await del(store, r[key] as string);
    }
    for (const p of await getAllBy<Prerequisite>("prerequisites", "studentId", sid)) await del("prerequisites", [p.itemId, p.prereqItemId]);
  }
  private async getLastSynced(sid: string): Promise<string | null> {
    this.lastSyncedAt = (await get<string>("meta", `lastSyncedAt:${sid}`)) ?? null; return this.lastSyncedAt;
  }
  private async setLastSynced(sid: string, at: string): Promise<void> {
    this.lastSyncedAt = at; await put("meta", at, `lastSyncedAt:${sid}`);
  }
}

const KEY: Record<string, string> = { subject: "subject_id", learning_item: "item_id", note: "note_id", test: "test_id" };
const enc = encodeURIComponent;
const quote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);
const group = (rows: Row[], key: string) => rows.reduce<Record<string, Row[]>>((m, r) => { (m[s(r[key])] ??= []).push(r); return m; }, {});