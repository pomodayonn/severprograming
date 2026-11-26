// SyncManager（Entity Manager／フロントエンド）：端末（IndexedDB）とアカウント（Neon）のデータをそろえる
// 担当：
// ・Neon の Data API（PostgREST の形）を、ログインの JWT を付けて HTTP で直接呼ぶ（Render のサーバーは通さない）
// ・どの行を読み書きできるかは、Neon の RLS が JWT の学生IDで決める（db/rls.sql）
// ・.env に VITE_NEON_DATA_API_URL がなければ何もしない（端末だけで動く）
// ・資料と文字起こしは端末だけなので、同期しない
//
// 【このファイルで何が起きているか】
// 端末（IndexedDB）とクラウド（Neon）のデータをそろえる係です。
// ・pullAll（受け取る）：ログインしたとき・「最新にする」を押したとき。Neon から自分のデータを全部もらい、端末のデータをそれに置き換える
//     → だから別の端末で作った科目も出てくる
//     11/23：置き換えは1つのトランザクションでする（途中で止まっても、端末のデータが空にならない）
// ・pullIfStale（古ければ受け取る）：ページを開き直したとき。前回受け取ってから30分たっていなければ受け取らず、端末のデータをそのまま使う（11/23）
// ・pushChanges（送る）：保存したとき。前回送った時刻（lastSyncedAt）より新しいものと、消したものだけを送る
//     → 毎回全部を送らないので速い
// ・ノートの食い違い（11/24、UC-018 代替フロー(2)）：ノートは「アカウントの更新日時（updated_at）が、前回受け取った・送ったときのまま
//     （noteBases に覚えておく）なら書き換える」という条件付きで送る。書き換わらなければ、別の端末で新しく保存されたということなので、送らずに
//     「食い違っているノート」（noteConflicts）に入れ、画面に知らせる（NoteConflictListener）。どちらにするかは学生が選ぶ（keepMineNote・takeRemoteNote）
//     保存したときだけでなく、ネットにつながり直して送ったとき・「最新にする」のときも、見つかったらすぐ知らせる
// Neon の表は「subject_name」のような snake_case、beans は「subjectName」のような camelCase なので、ここで書き換えている。
// 「自分のデータだけ」に絞るのは Neon の RLS（db/rls.sql）。JWT の中の学生IDを見て、他人の行は返さない
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
import { PartType } from "../enums/PartType";
import type { TestType } from "../enums/TestType";
import type { NeonAuthClient } from "../boundary/NeonAuthClient";
import type { LearningItem as Item } from "../beans/LearningItem";
import type { NoteConflict, NoteConflictListener } from "../interfaces/NoteConflictListener";
import { del, get, getAll, getAllBy, put, replaceStudentData, type Deletion } from "../dao/idb";
import { isPullStale } from "../lib/logic";

type Row = Record<string, unknown>;
export class SyncError extends Error {}

export class SyncManager {
  /** Neon に note_part.style 列がまだないと分かったら true（11/25）。そのあとは style をのぞいて送る */
  private noStyleColumn = false;
  /** 前回同期した日時（学生ごとに端末に保存する） */
  lastSyncedAt: string | null = null;
  private running: Promise<void> | null = null;
  /** ノートの食い違いを知らせる相手（11/24。画面が Controller を通して渡す） */
  private conflictListener: NoteConflictListener | null = null;

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
    const sid = student.studentId;
    const sub = subjects.map(r => new Subject({ subjectId: s(r.subject_id), studentId: sid, subjectName: s(r.subject_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const its = items.map(r => new LearningItem({ itemId: s(r.item_id), studentId: sid, subjectId: s(r.subject_id), itemName: s(r.item_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const pres = prereqs.map(r => new Prerequisite({ studentId: sid, itemId: s(r.item_id), prereqItemId: s(r.prereq_item_id), updatedAt: s(r.updated_at) }));
    const nts: Note[] = toNotes(notes, partsBy, wordsBy, sid);
    // 11/24：食い違ったまま（どちらにするか、まだ選んでいない）ノートは、受け取りで消さずに、この端末の内容を残す。
    // 覚えておく更新日時も前のままにする（そうしないと、次に保存したときに食い違いに気づけない）
    const oldBases = await this.getBases(sid), bases: Record<string, string> = {}, conflicts: string[] = [];
    for (const r of notes) bases[s(r.note_id)] = s(r.updated_at);
    for (const id of await this.getConflicts(sid)) {
      const i = nts.findIndex(x => x.noteId === id), mine = await get<Note>("notes", id);
      if (i < 0 || !mine) continue; // 別の端末で学習項目ごと消されていたら、食い違いもなくなる
      nts[i] = mine; bases[id] = oldBases[id] ?? bases[id]; conflicts.push(id);
    }
    const tss = tests.map(r => new Test({
      testId: s(r.test_id), studentId: sid, itemId: s(r.item_id), testType: s(r.test_type) as TestType, questionCount: num(r.question_count),
      createdAt: s(r.created_at), lastTakenAt: n(r.last_taken_at), updatedAt: s(r.updated_at),
      questions: (qBy[s(r.test_id)] ?? []).map(q => new Question({ questionId: s(q.question_id), studentId: sid, testId: s(q.test_id), number: num(q.number), questionText: s(q.question_text), modelAnswer: s(q.model_answer), explanation: n(q.explanation), updatedAt: s(q.updated_at) })).sort((a, b) => a.number - b.number),
      attempts: (aBy[s(r.test_id)] ?? []).map(a => new Attempt({
        attemptId: s(a.attempt_id), studentId: sid, testId: s(a.test_id), attemptNo: num(a.attempt_no), takenAt: s(a.taken_at), updatedAt: s(a.updated_at),
        answers: (ansBy[s(a.attempt_id)] ?? []).map(x => new Answer({ answerId: s(x.answer_id), studentId: sid, attemptId: s(x.attempt_id), questionId: s(x.question_id), studentAnswer: s(x.student_answer), correct: x.correct === null || x.correct === undefined ? null : !!x.correct, answeredAt: s(x.answered_at), updatedAt: s(x.updated_at) })),
      })).sort((a, b) => a.attemptNo - b.attemptNo),
    }));
    // ---- 端末のこの学生のデータを、受け取った内容に置き換える（11/23：1つのトランザクションで） ----
    const t = now();
    await replaceStudentData(sid, { subjects: sub, learningItems: its, prerequisites: pres, notes: nts, tests: tss },
      { [`lastSyncedAt:${sid}`]: t, [`lastPulledAt:${sid}`]: t, [`noteBases:${sid}`]: bases, [`noteConflicts:${sid}`]: conflicts });
    this.lastSyncedAt = t;
  }

  /**
   * 前回受け取ってから30分以上たっていれば pullAll する（11/23）。ページを開き直したときに AccountManager から呼ぶ。
   * 30分以内なら、端末のデータ（前回受け取った分＋この端末での変更）をそのまま使う
   */
  async pullIfStale(): Promise<void> {
    if (!this.enabled) return;
    const student = await this.authClient.getSession(); if (!student) return;
    const last = await get<string>("meta", `lastPulledAt:${student.studentId}`);
    if (isPullStale(last, Date.now())) await this.pullAll();
  }

  /** 前回受け取った時刻を忘れる（ログアウトのとき）。次にログインしたら、30分以内でも必ず受け取り直す（11/23） */
  async forgetPull(studentId: string): Promise<void> {
    await del("meta", `lastPulledAt:${studentId}`);
  }

  /**
   * 前回の同期より後に変わったデータ（updatedAt が新しいもの）と、消したデータだけをアカウントに送る。
   * SubjectManager・LearningItemManager・NoteManager・TestManager が保存したあとに呼ぶ。同時に呼ばれても1回ずつ順に送る
   */
  async pushChanges(): Promise<void> {
    if (!this.enabled) return;
    const prev = this.running ?? Promise.resolve();
    const run = prev.then(() => this.push());
    // 順番待ち用の印。失敗しても次の送信は続けられるように、エラーはここでは捨てる（呼んだ側には run でエラーが届く）
    const tail: Promise<void> = run.catch(() => {}).then(() => { if (this.running === tail) this.running = null; });
    this.running = tail;
    return run;
  }

  /**
   * まだ送っていない変更をアカウントへ送る。
   * ログアウトで端末のデータを消す前に AccountManager が呼ぶ。
   *
   * 以下の場合は false を返して端末データの削除を止める。
   * ・同期の設定がない
   * ・ログイン状態を確認できない
   * ・通信や競合情報の取得に失敗した
   * ・未解決のノートの競合が残っている
   * ・同期中にアカウントが変更された
   */
  async sendAll(): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      // 同期対象の学生を確認する。
      const student = await this.authClient.getSession();
      if (!student) return false;

      // 端末に保存されている変更をアカウントへ送る。
      await this.pushChanges();

      // 未解決の競合が残っている場合は削除を許可しない。
      const conflicts = await this.getConflicts(student.studentId);
      if (conflicts.length > 0) return false;

      // 同期前後でログイン中の学生が変わっていないか確認する。
      const current = await this.authClient.getSession();

      if (!current || current.studentId !== student.studentId) {
        return false;
      }

      return true;
    } catch {
      // 同期結果を確認できない場合はデータ保護を優先する。
      return false;
    }
  }


  /** ノートの食い違いを知らせる相手を決める（11/24）。null なら知らせない */
  setNoteConflictListener(listener: NoteConflictListener | null): void { this.conflictListener = listener; }

  /**
   * まだどちらにするか選んでいないノートがあれば、知らせ直す（11/24）。
   * 選ぶ前にタブを閉じた場合などのために、ログインしたとき・ページを開き直したときに画面から呼ぶ
   */
  async notifyPendingConflicts(): Promise<void> {
    const student = await this.authClient.getSession(); if (!student) return;
    await this.notify(await this.getConflicts(student.studentId));
  }

  /**
   * 「上書きして保存」を選んだとき（11/24）。アカウントの今の更新日時を「前回見た日時」にして、食い違いを外す。
   * このあと NoteManager がノートを保存し直すと、この端末の内容がアカウントに送られる
   */
  async keepMineNote(noteId: string): Promise<void> {
    const student = await this.authClient.getSession(); if (!student) return;
    const sid = student.studentId, bases = await this.getBases(sid), remote = await this.remoteNoteVersion(noteId);
    if (remote) bases[noteId] = remote; else delete bases[noteId];
    await this.setBases(sid, bases);
    await this.setConflicts(sid, (await this.getConflicts(sid)).filter(id => id !== noteId));
  }

  /**
   * 「別の端末の内容にする」を選んだとき（11/24）。アカウントのノートを受け取って、この端末のノートを置き換える（この端末の変更は捨てる）。
   * 受け取ったノートを返す。アカウントにノートがなければ（別の端末で消されていた）null
   */
  async takeRemoteNote(noteId: string): Promise<Note | null> {
    const student = await this.authClient.getSession(); if (!student) return null;
    const sid = student.studentId, id = enc(noteId);
    const [row] = (await this.request("GET", `/note?select=*&note_id=eq.${id}`)) as Row[];
    const bases = await this.getBases(sid);
    let note: Note | null = null;
    if (row) {
      const parts = (await this.request("GET", `/note_part?select=*&note_id=eq.${id}`)) as Row[];
      const words = parts.length ? (await this.request("GET", `/word?select=*&part_id=in.(${parts.map(p => quote(s(p.part_id))).join(",")})`)) as Row[] : [];
      [note] = toNotes([row], group(parts, "note_id"), group(words, "part_id"), sid);
      await put("notes", structuredClone(note));
      bases[noteId] = s(row.updated_at);
    } else delete bases[noteId];
    await this.setBases(sid, bases);
    await this.setConflicts(sid, (await this.getConflicts(sid)).filter(x => x !== noteId));
    return note;
  }

  // ======================= ここから private =======================
  private async push(): Promise<void> {
    const student = await this.authClient.getSession(); if (!student) return;
    const sid = student.studentId, since = await this.getLastSynced(sid), started = now();
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
    // 11/24：別の端末で新しく保存されていたら、送らずに noteConflicts に入れる（UC-018 代替フロー(2)）
    const bases = await this.getBases(sid), found: string[] = [];
    let conflicts = await this.getConflicts(sid);
    for (const note of newer(await getAll<Note>("notes"))) {
      // return=representation：保存したあとの行（Neon が入れた updated_at）を返してもらい、次に送るときのために覚えておく
      const base = bases[note.noteId];
      const [saved] = (base
        // 前回見た更新日時のときだけ書き換える。「確かめる」と「保存する」を1回の通信でするので、通信が増えず、その間に別の端末が保存するすき間もない
        ? await this.request("PATCH", `/note?note_id=eq.${enc(note.noteId)}&updated_at=eq.${enc(base)}`, { item_id: note.itemId, last_saved_at: note.lastSavedAt }, "return=representation")
        // まだ一度も受け取っても送ってもいないノート（新しく作ったノートなど）は、確かめずに送る
        : await this.request("POST", "/note", [{ note_id: note.noteId, item_id: note.itemId, last_saved_at: note.lastSavedAt }], "resolution=merge-duplicates,return=representation")) as Row[];
      if (!saved) { // 1行も書き換わらなかった＝アカウントの更新日時が変わっていた（別の端末で保存された）
        if (!conflicts.includes(note.noteId)) { conflicts = [...conflicts, note.noteId]; await this.setConflicts(sid, conflicts); }
        found.push(note.noteId);
        continue;
      }
      const ids = note.parts.map(p => p.partId);
      await this.request("DELETE", `/note_part?note_id=eq.${enc(note.noteId)}${ids.length ? `&part_id=not.in.(${ids.map(quote).join(",")})` : ""}`);
      const partRows = note.parts.map(p => ({ part_id: p.partId, note_id: note.noteId, part_type: p.partType, frame_type: p.frameType, shape: p.partType === PartType.SHAPE ? NotePart.shapeOf(p) : null, x: Math.round(p.x), y: Math.round(p.y), width: Math.max(1, Math.round(p.width)), height: Math.max(1, Math.round(p.height)), color: p.color, text: p.text, heading_level: p.headingLevel, style: p.style ?? "" }));
      // 11/25：文字の書式（style 列）も送る。Neon にまだ style 列がないとき（db/schema.sql の ALTER TABLE をまだ流していないとき）は、
      // 断られるので、style をのぞいて（undefined は JSON に入らない）もう一度送る（書式は端末には残る。列を足したあとの保存で送られる）
      try { await this.upsert("note_part", this.noStyleColumn ? partRows.map(r => ({ ...r, style: undefined })) : partRows); }
      catch (e) {
        if (this.noStyleColumn || !(e instanceof SyncError) || !e.message.includes("400")) throw e;
        this.noStyleColumn = true; await this.upsert("note_part", partRows.map(r => ({ ...r, style: undefined })));
      }
      // 消した単語を Neon からも消す。11/21：前は部品1つごとに1回送っていたが、部品20個ずつまとめて1回で送るようにした
      // （全部を1回にしないのは、URL が長くなりすぎてサーバーに断られないようにするため）
      for (const group of chunk(note.parts, 20)) {
        const wids = group.flatMap(p => p.words.map(w => w.wordId));
        await this.request("DELETE", `/word?part_id=in.(${group.map(p => quote(p.partId)).join(",")})${wids.length ? `&word_id=not.in.(${wids.map(quote).join(",")})` : ""}`);
      }
      await this.upsert("word", note.parts.flatMap(p => p.words.map(w => ({ word_id: w.wordId, part_id: p.partId, term: w.term, meaning: w.meaning }))));
      bases[note.noteId] = s(saved.updated_at); await this.setBases(sid, bases);
      if (conflicts.includes(note.noteId)) { conflicts = conflicts.filter(x => x !== note.noteId); await this.setConflicts(sid, conflicts); }
    }
    await this.notify(found); // 11/24：見つかったらすぐ画面に知らせる（残りのテストなどは、このあと続けて送る）
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
  /** 食い違っているノートを、どの学習項目のノートか分かる形にして画面に知らせる（11/24） */
  private async notify(noteIds: string[]): Promise<void> {
    if (!noteIds.length || !this.conflictListener) return;
    const list: NoteConflict[] = [];
    for (const noteId of noteIds) {
      const note = await get<Note>("notes", noteId); if (!note) continue;
      const item = await get<Item>("learningItems", note.itemId);
      list.push({ noteId, itemId: note.itemId, itemName: item?.itemName ?? "" });
    }
    if (list.length) this.conflictListener.onNoteConflict(list);
  }
  /** アカウントのそのノートの更新日時（11/24。「上書きして保存」を選んだときだけ使う）。アカウントにまだなければ null */
  private async remoteNoteVersion(noteId: string): Promise<string | null> {
    const [row] = (await this.request("GET", `/note?select=updated_at&note_id=eq.${enc(noteId)}`)) as Row[];
    return row ? s(row.updated_at) : null;
  }
  /** ノートごとの「前回受け取った・送ったときのアカウントの更新日時」（ノートID → 更新日時）（11/24） */
  private async getBases(sid: string): Promise<Record<string, string>> {
    return { ...((await get<Record<string, string>>("meta", `noteBases:${sid}`)) ?? {}) };
  }
  private async setBases(sid: string, bases: Record<string, string>): Promise<void> {
    await put("meta", bases, `noteBases:${sid}`);
  }
  /** 食い違っていて送れていないノートのID（11/24） */
  private async getConflicts(sid: string): Promise<string[]> {
    return (await get<string[]>("meta", `noteConflicts:${sid}`)) ?? [];
  }
  private async setConflicts(sid: string, ids: string[]): Promise<void> {
    await put("meta", ids, `noteConflicts:${sid}`);
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
/** Neon の note・note_part・word の行から、ノート（部品・単語入り）の beans を作る（pullAll と takeRemoteNote で使う） */
function toNotes(notes: Row[], partsBy: Record<string, Row[]>, wordsBy: Record<string, Row[]>, sid: string): Note[] {
  return notes.map(r => new Note({
    noteId: s(r.note_id), studentId: sid, itemId: s(r.item_id), lastSavedAt: n(r.last_saved_at), updatedAt: s(r.updated_at),
    parts: (partsBy[s(r.note_id)] ?? []).map(p => new NotePart({
      partId: s(p.part_id), studentId: sid, noteId: s(p.note_id), partType: s(p.part_type) as PartType, frameType: n(p.frame_type), shape: p.shape === "rect" || p.shape === "ellipse" ? p.shape : null,
      x: num(p.x), y: num(p.y), width: num(p.width), height: num(p.height), color: s(p.color), text: s(p.text), headingLevel: num(p.heading_level), style: s(p.style), updatedAt: s(p.updated_at),
      words: (wordsBy[s(p.part_id)] ?? []).map(w => new Word({ wordId: s(w.word_id), studentId: sid, partId: s(w.part_id), term: s(w.term), meaning: s(w.meaning), updatedAt: s(w.updated_at) })),
    })),
  }));
}
/** 配列を size 個ずつに分ける */
const chunk = <T>(a: T[], size: number): T[][] => Array.from({ length: Math.ceil(a.length / size) }, (_, i) => a.slice(i * size, (i + 1) * size));
const group = (rows: Row[], key: string) => rows.reduce<Record<string, Row[]>>((m, r) => { (m[s(r[key])] ??= []).push(r); return m; }, {});