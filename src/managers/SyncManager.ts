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
import { AppError } from "./common";

type Row = Record<string, unknown>;
export class SyncError extends AppError {}

/**
 * SYNC-13：
 * クラウドから受信したデータの主キーと
 * 親子関係の整合性を検証する。
 *
 * 不整合がある場合は端末データを
 * 置き換える前に処理を中止する。
 */
function validateReceivedGraph(
  data: Record<string, Row[]>
): void {
  const fail = (detail: string): never => {
    throw new SyncError(
      `受信データの整合性を確認できません。端末のデータを保護するため最新化を中止しました（${detail}）`
    );
  };

  // 主キーの形式と重複を検証する。
  const index = (
    table: string,
    key: string
  ): Map<string, Row> => {
    const result = new Map<string, Row>();

    for (const row of data[table]) {
      const id = row[key];

      if (typeof id !== "string" || !id.trim()) {
        fail(`${table}.${key} の欠落`);
      }

      const validId = id as string;

      if (result.has(validId)) {
        fail(`${table}.${key} の重複`);
      }

      result.set(validId, row);
    }

    return result;
  };

  const subjects =
    index("subject", "subject_id");

  const items =
    index("learning_item", "item_id");

  const notes =
    index("note", "note_id");

  const parts =
    index("note_part", "part_id");

  index("word", "word_id");

  const tests =
    index("test", "test_id");

  const questions =
    index("question", "question_id");

  const attempts =
    index("attempt", "attempt_id");

  index("answer", "answer_id");

  // 子データが参照する親が存在するか確認する。
  const check = (
    table: string,
    key: string,
    parents: Map<string, Row>,
    relation: string
  ): void => {
    for (const row of data[table]) {
      const id = row[key];

      if (
        typeof id !== "string" ||
        !parents.has(id)
      ) {
        fail(relation);
      }
    }
  };

  check(
    "learning_item",
    "subject_id",
    subjects,
    "learning_item → subject"
  );

  check(
    "prerequisite",
    "item_id",
    items,
    "prerequisite → learning_item"
  );

  check(
    "prerequisite",
    "prereq_item_id",
    items,
    "prerequisite → prerequisite_item"
  );

  check(
    "note",
    "item_id",
    items,
    "note → learning_item"
  );

  check(
    "note_part",
    "note_id",
    notes,
    "note_part → note"
  );

  check(
    "word",
    "part_id",
    parts,
    "word → note_part"
  );

  check(
    "test",
    "item_id",
    items,
    "test → learning_item"
  );

  check(
    "question",
    "test_id",
    tests,
    "question → test"
  );

  check(
    "attempt",
    "test_id",
    tests,
    "attempt → test"
  );

  check(
    "answer",
    "attempt_id",
    attempts,
    "answer → attempt"
  );

  check(
    "answer",
    "question_id",
    questions,
    "answer → question"
  );

  // SYNC-15a: 親の存在だけでは検出できない参照関係を検証する。
  const prerequisiteKeys = new Set<string>();
  for (const row of data.prerequisite) {
    const itemId = String(row.item_id);
    const prereqId = String(row.prereq_item_id);
    if (itemId === prereqId) {
      fail("prerequisite の自己参照");
    }
    // 上の check() で両方の親IDの存在を確認済み。
    if (items.get(itemId)!.subject_id !== items.get(prereqId)!.subject_id) {
      fail("prerequisite の科目不一致");
    }
    const key = JSON.stringify([itemId, prereqId]);
    if (prerequisiteKeys.has(key)) {
      fail("prerequisite の複合主キー重複");
    }
    prerequisiteKeys.add(key);
  }

  for (const row of data.answer) {
    const attempt = attempts.get(String(row.attempt_id))!;
    const question = questions.get(String(row.question_id))!;
    if (attempt.test_id !== question.test_id) {
      fail("answer のテスト不一致");
    }
  }

  // テストに設定された問題数と
  // 実際に受信した問題数を比較する。
  const counts = new Map<string, number>();

  for (const question of data.question) {
    const id = String(question.test_id);

    counts.set(
      id,
      (counts.get(id) ?? 0) + 1
    );
  }

  for (const [id, test] of tests) {
    const expected = test.question_count;
    const actual = counts.get(id) ?? 0;

    if (
      typeof expected !== "number" ||
      !Number.isInteger(expected) ||
      expected < 1 ||
      expected !== actual
    ) {
      fail("test.question_count の不一致");
    }
  }
}

/** SYNC-14c: 削除ログ全件を検証し、通信前に対象パスを確定する。
 * 不正なログは自動修復・削除せず、その回の同期を中止する。
 */
function prepareOutgoingDeletions(sid: string, logs: Deletion[]): { log: Deletion; path: string }[] {
  const fail = (detail: string): never => {
    throw new SyncError(`削除ログの整合性を確認できません（${detail}）`);
  };
  // newId() は英数字。既存のハイフン・アンダースコア付きIDも許容する。
  // フィルタ構文に使われる文字や空欄を含むIDは安全のため保留する。
  const validId = (id: string) => id.length > 0 && !/[^A-Za-z0-9_-]/.test(id);
  const seen = new Set<string>();
  const prepared = logs.map(d => {
    if (!d || typeof d !== "object") return fail("形式");
    if (d.studentId !== sid) return fail("所有者");
    if (typeof d.table !== "string" || (d.table !== "prerequisite" && !Object.prototype.hasOwnProperty.call(KEY, d.table))) {
      return fail("テーブル名");
    }
    if (typeof d.key !== "string") return fail("主キー");
    if (typeof d.at !== "string" || !Number.isFinite(Date.parse(d.at)) || new Date(d.at).toISOString() !== d.at) {
      return fail("削除日時");
    }
    let filter: string;
    if (d.table === "prerequisite") {
      const ids = d.key.split("|");
      if (ids.length !== 2 || !ids.every(validId)) return fail("複合キー");
      filter = `item_id=eq.${enc(ids[0])}&prereq_item_id=eq.${enc(ids[1])}`;
    } else {
      if (!validId(d.key)) return fail("主キー");
      filter = `${KEY[d.table]}=eq.${enc(d.key)}`;
    }
    const identity = JSON.stringify([d.table, d.key]);
    if (seen.has(identity)) return fail("重複");
    seen.add(identity);
    return { log: d, path: `/${d.table}?${filter}` };
  });
  // 日時の形式を全件確認してから並べ替える。
  return prepared.sort((a, b) => a.log.at.localeCompare(b.log.at));
}

/** SYNC-14b: 今回送るルート行と、その親を端末の保存済みデータで検証する。
 * 親は今回の送信対象でなくてもよいが、同じ学生のものでなければならない。
 */
function validateOutgoingRoots(
  sid: string, allSubjects: Subject[], allItems: LearningItem[],
  items: LearningItem[], prereqs: Prerequisite[], notes: Note[], tests: Test[]
): void {
  const subjectIds = new Set(allSubjects.filter(x => x.studentId === sid).map(x => x.subjectId));
  const itemById = new Map(allItems.filter(x => x.studentId === sid).map(x => [x.itemId, x]));
  const validId = (id: string) => typeof id === "string" && id.trim().length > 0;
  const fail = (relation: string): never => {
    throw new SyncError(`送信データの参照先を確認できません（${relation}）`);
  };
  const checkSubject = (item: LearningItem) => {
    if (!validId(item.subjectId) || !subjectIds.has(item.subjectId)) fail("learning_item → subject");
  };
  const requireItem = (id: string, relation: string): LearningItem => {
    const item = validId(id) ? itemById.get(id) : undefined;
    if (!item) return fail(relation);
    checkSubject(item);
    return item;
  };
  for (const item of items) checkSubject(item);
  for (const link of prereqs) {
    const item = requireItem(link.itemId, "prerequisite → item_id");
    const parent = requireItem(link.prereqItemId, "prerequisite → prereq_item_id");
    if (item.itemId === parent.itemId) fail("prerequisite の自己参照");
    if (item.subjectId !== parent.subjectId) fail("prerequisite の科目不一致");
  }
  for (const note of notes) requireItem(note.itemId, "note → learning_item");
  for (const test of tests) requireItem(test.itemId, "test → learning_item");
}

/** SYNC-14a: 保存済みの入れ子データを送信前に検証する。
 * 送信時に親IDや所有者を付け直す処理で不整合を隠さない。
 */
function validateOutgoingChildren(sid: string, notes: Note[], tests: Test[]): void {
  const owner = (row: { studentId: string }, table: string): void => {
    if (row.studentId !== sid) {
      throw new SyncError(`送信データの所有者が一致しません（${table}）`);
    }
  };
  const parent = (actual: string, expected: string, relation: string): void => {
    if (typeof expected !== "string" || !expected.trim() || actual !== expected) {
      throw new SyncError(`送信データの親子関係が一致しません（${relation}）`);
    }
  };
  for (const note of notes) {
    for (const part of note.parts) {
      owner(part, "note_part");
      parent(part.noteId, note.noteId, "note_part → note");
      for (const word of part.words) {
        owner(word, "word");
        parent(word.partId, part.partId, "word → note_part");
      }
    }
  }
  for (const test of tests) {
    const questionIds = new Set<string>();
    for (const question of test.questions) {
      owner(question, "question");
      parent(question.testId, test.testId, "question → test");
      questionIds.add(question.questionId);
    }
    for (const attempt of test.attempts) {
      owner(attempt, "attempt");
      parent(attempt.testId, test.testId, "attempt → test");
      for (const answer of attempt.answers) {
        owner(answer, "answer");
        parent(answer.attemptId, attempt.attemptId, "answer → attempt");
        if (typeof answer.questionId !== "string" || !answer.questionId.trim() || !questionIds.has(answer.questionId)) {
          throw new SyncError("送信データの親子関係が一致しません（answer → question）");
        }
      }
    }
  }
}

export class SyncManager {
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
        const student = await this.authClient.getSession();

    if (!student?.studentId) {
      throw new SyncError(
        "ログイン状態を確認できないため最新化できません"
      );
    }

    const sid = student.studentId;
    await this.pushChanges(student.studentId);

    const current = await this.authClient.getSession();

    if (current?.studentId !== sid) {
      throw new SyncError(
        "同期中にログイン状態が変更されたため最新化を中止しました"
      );
    }
    const [subjects, items, prereqs, notes, parts, words, tests, questions, attempts, answers] = await Promise.all(
      ["subject", "learning_item", "prerequisite", "note", "note_part", "word", "test", "question", "attempt", "answer"].map(t => this.select(sid, t)));
    // ---- Neon の形（スネークケース・別々のテーブル）から、端末の形（beans・入れ子）に戻す ----
        // 受信した全テーブルの所有者を確認する。
    // 不正なデータを端末用の形式へ変換する前に拒否する。
    const received = {
      subject: subjects,
      learning_item: items,
      prerequisite: prereqs,
      note: notes,
      note_part: parts,
      word: words,
      test: tests,
      question: questions,
      attempt: attempts,
      answer: answers,
    };

    for (const [table, rows] of Object.entries(received)) {
      if (!Array.isArray(rows)) {
        throw new SyncError(
          `受信データの形式が不正です（${table}）`
        );
      }

      if (rows.some(row => row?.student_id !== sid)) {
        throw new SyncError(
          `受信データの所有者が一致しないため最新化を中止しました（${table}）`
        );
      }
    }
    // 親子関係が不完全な受信データで
    // 端末データを置き換えない。
    validateReceivedGraph(received);

    const wordsBy = group(words, "part_id");
    const partsBy = group(parts, "note_id");

    const qBy = group(questions, "test_id");
    const aBy = group(attempts, "test_id");
    const ansBy = group(answers, "attempt_id");
    const sub = subjects.map(r => new Subject({ subjectId: s(r.subject_id), studentId: sid, subjectName: s(r.subject_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const its = items.map(r => new LearningItem({ itemId: s(r.item_id), studentId: sid, subjectId: s(r.subject_id), itemName: s(r.item_name), createdAt: s(r.created_at), updatedAt: s(r.updated_at) }));
    const pres = prereqs.map(r => new Prerequisite({ studentId: sid, itemId: s(r.item_id), prereqItemId: s(r.prereq_item_id), updatedAt: s(r.updated_at) }));
    const nts: Note[] = toNotes(notes, partsBy, wordsBy, sid);
    // 11/24：食い違ったまま（どちらにするか、まだ選んでいない）ノートは、受け取りで消さずに、この端末の内容を残す。
    // 覚えておく更新日時も前のままにする（そうしないと、次に保存したときに食い違いに気づけない）
    const oldBases = await this.getBases(sid), bases: Record<string, string> = {}, conflicts: string[] = [];
    for (const r of notes) bases[s(r.note_id)] = s(r.updated_at);
    for (const id of await this.getConflicts(sid)) {
      const i = nts.findIndex(x => x.noteId === id);
      const mine = await get<Note>("notes", id);

      if (!mine) continue;

      // 他の学生のデータが混入していないか確認する。
      if (mine.studentId !== sid) {
        throw new SyncError("ノートの所有者を確認できないため同期を中止しました");
      }

      // クラウドに存在しない競合ノートを消さない。
      // 端末データの置き換え自体を中止する。
      if (i < 0) {
        throw new SyncError(
          "クラウドに存在しない未解決のノートがあります。端末のデータを保護するため、最新化を中止しました"
        );
      }

      nts[i] = mine;
      bases[id] = oldBases[id] ?? bases[id];
      conflicts.push(id);
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
        // 受信中にログアウトやアカウント変更が
    // 発生していないか、置換直前に再確認する。
    const latest = await this.authClient.getSession();

    if (latest?.studentId !== sid) {
      throw new SyncError(
        "同期中にログイン状態が変更されたため最新化を中止しました"
      );
    }
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
  async pushChanges(
    expectedStudentId?: string
  ): Promise<void> {
    if (!this.enabled) return;

    // 待ち行列に入った時点の学生IDを保持する。
    const requested = expectedStudentId
      ? Promise.resolve(expectedStudentId)
      : this.authClient.getSession()
          .then(student =>
            student?.studentId ?? null
          );

    const prev =
      this.running ?? Promise.resolve();

    const run = prev.then(async () => {
      const sid = await requested;

      if (!sid) {
        throw new SyncError(
          "ログイン状態を確認できないため同期できません"
        );
      }

      await this.push(sid);
    });

    // 先行する同期が失敗しても
    // 後続の同期を実行できるようにする。
    const tail: Promise<void> = run
      .catch(() => {})
      .then(() => {
        if (this.running === tail) {
          this.running = null;
        }
      });

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
      await this.pushChanges(student.studentId);

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
    const student = await this.authClient.getSession();

    if (!student) {
      throw new SyncError("ログイン状態を確認できません");
    }

    const sid = student.studentId;
    const bases = await this.getBases(sid);
    const remote = await this.remoteNoteVersion(sid, noteId);

    // クラウドに存在しない場合は勝手に再登録しない。
    // 競合情報と端末のノートをそのまま残す。
    if (!remote) {
      throw new SyncError(
        "クラウドにノートが存在しないため上書きできません。端末のノートは保持されています"
      );
    }

    await this.requireSyncSession(sid);

    bases[noteId] = remote;

    await this.setBases(sid, bases);
    await this.setConflicts(
      sid,
      (await this.getConflicts(sid)).filter(id => id !== noteId)
    );
  }

  /**
   * 「別の端末の内容にする」を選んだとき（11/24）。アカウントのノートを受け取って、この端末のノートを置き換える（この端末の変更は捨てる）。
   * 受け取ったノートを返す。
   * アカウントにノートが存在しない場合は、端末データと競合情報を保持して例外を返す。
   */
    async takeRemoteNote(
    noteId: string
  ): Promise<Note | null> {
    const student =
      await this.authClient.getSession();

    if (!student?.studentId) {
      throw new SyncError(
        "ログイン状態を確認できません"
      );
    }

    const sid = student.studentId;
    const id = enc(noteId);

    const [row] = (
      await this.request(
        sid,
        "GET",
        `/note?select=*&note_id=eq.${id}`
      )
    ) as Row[];

    // 存在確認を所有者確認より先に行う。
    if (!row) {
      throw new SyncError(
        "クラウドにノートが存在しません。端末のノートは保持されています"
      );
    }

    if (row.student_id !== sid) {
      throw new SyncError(
        "ノートの所有者が一致しません"
      );
    }

    const parts = (
      await this.request(
        sid,
        "GET",
        `/note_part?select=*&note_id=eq.${id}`
      )
    ) as Row[];

    const words = parts.length
      ? (
          await this.request(
            sid,
            "GET",
            `/word?select=*&part_id=in.(${parts.map(p => quote(s(p.part_id))).join(",")})`
          )
        ) as Row[]
      : [];

    if (
      parts.some(p => p.student_id !== sid) ||
      words.some(w => w.student_id !== sid)
    ) {
      throw new SyncError(
        "ノート部品または単語の所有者が一致しません"
      );
    }

    const bases = await this.getBases(sid);

    const [note] = toNotes(
      [row],
      group(parts, "note_id"),
      group(words, "part_id"),
      sid
    );

    // 端末データを変更する直前に認証を確認する。
    await this.requireSyncSession(sid);

    await put(
      "notes",
      structuredClone(note)
    );

    bases[noteId] = s(row.updated_at);

    await this.setBases(sid, bases);

    await this.setConflicts(
      sid,
      (await this.getConflicts(sid))
        .filter(x => x !== noteId)
    );

    return note;
  }

  // ======================= ここから private =======================
    /**
   * 同期対象の学生と現在の認証情報が
   * 一致していることを確認する。
   */
  private async requireSyncSession(
    sid: string
  ) {
    const session =
      await this.authClient.getSyncSession();

    if (
      !session?.token ||
      session.studentId !== sid
    ) {
      throw new SyncError(
        "同期中にログイン状態が変更されたため同期を中止しました"
      );
    }

    return session;
  }

    private async push(sid: string): Promise<void> {
    await this.requireSyncSession(sid);

    const since =
      await this.getLastSynced(sid);

    const started = now();
    const newer = <T extends { updatedAt: string; studentId: string }>(rows: T[]) => rows.filter(r => r.studentId === sid && (!since || r.updatedAt > since));

    // 今回処理する削除ログを先に確定する。ノート・テスト取得後の削除を
    // 同じ送信で消費して、取得済みの古いデータを再登録しないようにする。
    const dels = prepareOutgoingDeletions(sid, await getAllBy<Deletion>("deletions", "studentId", sid));

    // 今回送るノート・テストを先に取得し、同じデータを検証と送信に使う。
    // 不整合があれば削除ログを含むHTTP通信を始めず、端末データを保持する。
    const changedNotes = newer(await getAll<Note>("notes"));
    const changedTests = newer(await getAll<Test>("tests"));
    validateOutgoingChildren(sid, changedNotes, changedTests);

    // 親を差分抽出する前に全件取得し、未変更の親も参照検証に使う。
    // 送信するデータをすべてHTTP通信前に取得し、検証済みの配列を使う。
    const allSubjects = await getAll<Subject>("subjects");
    const allItems = await getAll<LearningItem>("learningItems");
    const subjects = newer(allSubjects);
    const items = newer(allItems);
    const prereqs = newer(await getAll<Prerequisite>("prerequisites"));
    validateOutgoingRoots(sid, allSubjects, allItems, items, prereqs, changedNotes, changedTests);

    // 1) 削除を先に送る（同じIDで作り直した場合に、あとの追加が消されないように）
    for (const { log: d, path } of dels) {
      await this.request(sid,"DELETE", path);
      await del("deletions", [d.table, d.key]);
    }
    // 2) 親から順に送る（外部キーがあるので、科目 → 学習項目 → 前提項目・ノート・テスト の順）
    await this.upsert(sid,"subject", subjects.map(x => ({ subject_id: x.subjectId, subject_name: x.subjectName, created_at: x.createdAt })));
    await this.upsert(sid,"learning_item", items.map(x => ({ item_id: x.itemId, subject_id: x.subjectId, item_name: x.itemName, created_at: x.createdAt })));
    await this.upsert(sid,"prerequisite", prereqs.map(x => ({ item_id: x.itemId, prereq_item_id: x.prereqItemId })), "item_id,prereq_item_id");

    // ノート：変わったノートは、部品と単語を丸ごと送り直す（消した部品は Neon からも消す）
    // 11/24：別の端末で新しく保存されていたら、送らずに noteConflicts に入れる（UC-018 代替フロー(2)）
    const bases = await this.getBases(sid), found: string[] = [];
    let conflicts = await this.getConflicts(sid);

    // 部品を含むノートを送信する前に、
    // 必要なカラムがクラウド側に存在することを確認する。
    // 確認できなければノートの更新処理を開始しない。
    if (changedNotes.some(note => note.parts.length > 0)) {
      await this.request(sid,
        "GET",
        "/note_part?select=shape,style&limit=1"
      );
    }

    for (const note of changedNotes) {
      // return=representation：保存したあとの行（Neon が入れた updated_at）を返してもらい、次に送るときのために覚えておく
      const base = bases[note.noteId];
      const [saved] = (base
        // 前回見た更新日時のときだけ書き換える。「確かめる」と「保存する」を1回の通信でするので、通信が増えず、その間に別の端末が保存するすき間もない
        ? await this.request(sid,"PATCH", `/note?note_id=eq.${enc(note.noteId)}&updated_at=eq.${enc(base)}`, { item_id: note.itemId, last_saved_at: note.lastSavedAt }, "return=representation")
        // まだ一度も受け取っても送ってもいないノート（新しく作ったノートなど）は、確かめずに送る
        : await this.request(sid,"POST", "/note", [{ note_id: note.noteId, item_id: note.itemId, last_saved_at: note.lastSavedAt }], "resolution=merge-duplicates,return=representation")) as Row[];
      if (!saved) { // 1行も書き換わらなかった＝アカウントの更新日時が変わっていた（別の端末で保存された）
        if (!conflicts.includes(note.noteId)) { conflicts = [...conflicts, note.noteId]; await this.setConflicts(sid, conflicts); }
        found.push(note.noteId);
        continue;
      }
      const partRows = note.parts.map(p => ({ part_id: p.partId, note_id: note.noteId, part_type: p.partType, frame_type: p.frameType, shape: p.partType === PartType.SHAPE ? NotePart.shapeOf(p) : null, x: Math.round(p.x), y: Math.round(p.y), width: Math.max(1, Math.round(p.width)), height: Math.max(1, Math.round(p.height)), color: p.color, text: p.text, heading_level: p.headingLevel, style: p.style ?? "" }));
      // 書式情報を含む部品データをそのまま送信する。
      // 同期に失敗した場合、書式を除外した再送信は行わない。
      await this.upsert(sid,"note_part", partRows);
      const ids = note.parts.map(p => p.partId);
      await this.request(sid,"DELETE", `/note_part?note_id=eq.${enc(note.noteId)}${ids.length ? `&part_id=not.in.(${ids.map(quote).join(",")})` : ""}`);
      // 消した単語を Neon からも消す。11/21：前は部品1つごとに1回送っていたが、部品20個ずつまとめて1回で送るようにした
      // （全部を1回にしないのは、URL が長くなりすぎてサーバーに断られないようにするため）
      for (const group of chunk(note.parts, 20)) {
        const wids = group.flatMap(p => p.words.map(w => w.wordId));
        await this.request(sid,"DELETE", `/word?part_id=in.(${group.map(p => quote(p.partId)).join(",")})${wids.length ? `&word_id=not.in.(${wids.map(quote).join(",")})` : ""}`);
      }
      await this.upsert(sid,"word", note.parts.flatMap(p => p.words.map(w => ({ word_id: w.wordId, part_id: p.partId, term: w.term, meaning: w.meaning }))));
      bases[note.noteId] = s(saved.updated_at); await this.setBases(sid, bases);
      if (conflicts.includes(note.noteId)) { conflicts = conflicts.filter(x => x !== note.noteId); await this.setConflicts(sid, conflicts); }
    }
    await this.notify(found); // 11/24：見つかったらすぐ画面に知らせる（残りのテストなどは、このあと続けて送る）
    // テスト：変わったテストは、問題・受験・解答を丸ごと送り直す
    for (const t of changedTests) {
      await this.upsert(sid,"test", [{ test_id: t.testId, item_id: t.itemId, test_type: t.testType, question_count: Math.max(1, t.questions.length), created_at: t.createdAt, last_taken_at: t.lastTakenAt }]);
      await this.upsert(sid,"question", t.questions.map(q => ({ question_id: q.questionId, test_id: t.testId, number: q.number, question_text: q.questionText, model_answer: q.modelAnswer, explanation: q.explanation })));
      await this.upsert(sid,"attempt", t.attempts.map(a => ({ attempt_id: a.attemptId, test_id: t.testId, attempt_no: a.attemptNo, taken_at: a.takenAt })));
      await this.upsert(sid,"answer", t.attempts.flatMap(a => a.answers.map(x => ({ answer_id: x.answerId, attempt_id: a.attemptId, question_id: x.questionId, student_answer: x.studentAnswer, correct: x.correct, answered_at: x.answeredAt }))));
    }
        // 同期完了時にもアカウントを確認する。
    await this.requireSyncSession(sid);
    await this.setLastSynced(sid, started); // 送っている間に変わったものは次回送る
  }

    /** 現在の学生のデータを受け取る */
  private async select(
    sid: string,
    table: string
  ): Promise<Row[]> {
    return (
      await this.request(
        sid,
        "GET",
        `/${table}?select=*`
      )
    ) as Row[];
  }
   /** 所有者を固定してデータを追加・更新する */
  private async upsert(
    sid: string,
    table: string,
    rows: Row[],
    onConflict?: string
  ): Promise<void> {
    if (!rows.length) return;
    await this.request(
      sid,
      "POST",
      `/${table}${onConflict ? `?on_conflict=${onConflict}` : ""}`,
      rows,
      "resolution=merge-duplicates,return=minimal"
    );
  }
  /**
   * 同期対象の学生と認証情報を確認し、
   * Data APIへ通信する。
   */
  private async request(
    sid: string,
    method: string,
    path: string,
    body?: unknown,
    prefer?: string
  ): Promise<unknown> {
    const session =
      await this.requireSyncSession(sid);

    let payload = body;

    // POST・PATCHでは所有者を明示する。
    if (
      body !== undefined &&
      (method === "POST" || method === "PATCH")
    ) {
      const withOwner = (row: Row): Row => {
        if (
          row.student_id !== undefined &&
          row.student_id !== sid
        ) {
          throw new SyncError(
            "送信データの所有者が一致しません"
          );
        }

        return {
          ...row,
          student_id: sid,
        };
      };

      payload = Array.isArray(body)
        ? body.map(row => withOwner(row))
        : withOwner(body as Row);
    }

    let res: Response;

    try {
      res = await fetch(
        this.dataApiUrl!.replace(/\/$/, "") + path,
        {
          method,

          headers: {
            Authorization:
              `Bearer ${session.token}`,

            "Content-Type":
              "application/json",

            ...(prefer
              ? { Prefer: prefer }
              : {}),
          },

          body: payload === undefined
            ? undefined
            : JSON.stringify(payload),
        }
      );
    } catch {
      throw new SyncError(
        "通信できないため同期できませんでした（端末には保存されています）"
      );
    }

    if (!res.ok) {
      throw new SyncError(
        `同期に失敗しました（${res.status}）`
      );
    }

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
   /** クラウドに保存されたノートの更新日時を取得する */
  private async remoteNoteVersion(
    sid: string,
    noteId: string
  ): Promise<string | null> {
    const [row] = (
      await this.request(
        sid,
        "GET",
        `/note?select=updated_at,student_id&note_id=eq.${enc(noteId)}`
      )
    ) as Row[];

    if (row && row.student_id !== sid) {
      throw new SyncError(
        "ノートの所有者が一致しません"
      );
    }

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