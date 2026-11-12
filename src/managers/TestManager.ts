// TestManager（Entity Manager／フロントエンド）：テストの作成・解答・採点・解説・直す機能を担当する
// 担当：（作成：11/10）
// 記述テストと解説だけ、services/ai.ts（ApiController）に頼んでAIを使う。保存したら SyncManager で同期する
import { Test } from "../beans/Test";
import { Question } from "../beans/Question";
import { Attempt } from "../beans/Attempt";
import { Answer } from "../beans/Answer";
import type { SendContent } from "../beans/SendContent";
import { now } from "../beans/DateTime";
import { PartType } from "../enums/PartType";
import { TestType } from "../enums/TestType";
import type { TestDAO } from "../dao/TestDAO";
import type { NoteDAO } from "../dao/NoteDAO";
import { explain as aiExplain, makeEssay, regenerateQuestion as aiRegenerate } from "../services/ai";
import { AppError, SEND_LIMIT, newId, pushQuietly, type ChangePusher } from "./common";
import type { Test as ScreenTest, TestKind } from "../types";

/** 画面に出す1回分の受験（何回目・日時・解答・正誤） */
export interface ScreenAttempt { no: number; at: number; ans: string[]; ok?: boolean[] }

/** 画面に出す文を持ったエラー */
export class TestError extends AppError {}

const shuffle = <T>(a: T[]): T[] => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export class TestManager {
  constructor(private readonly testDAO: TestDAO, private readonly noteDAO: NoteDAO, private syncManager: ChangePusher | null = null) {}

  setSyncManager(sync: ChangePusher) { this.syncManager = sync; }

  /**
   * AIを使わず単語枠から単語テストを作る。単語が足りなければある分だけ出題する（足りない数は shortage で分かる）。
   * partIds を渡したときは、その枠の単語だけを使う（G008 の「枠を選ぶ」）
   */
  async createWordTest(itemId: string, studentId: string, type: TestType.MEANING_TO_TERM | TestType.TERM_TO_MEANING, count: number, partIds?: string[]): Promise<{ test: Test; shortage: number }> {
    const words = await this.getWords(itemId, partIds);
    if (!words.length) throw new TestError("範囲に単語枠がない（または空）ため、先にノートで単語枠を作ってください");
    const n = clampCount(count), picked = shuffle(words).slice(0, n);
    const testId = newId();
    const questions = picked.map((w, i) => new Question({
      questionId: newId(), testId, studentId, number: i + 1,
      questionText: type === TestType.MEANING_TO_TERM ? w.meaning : w.term,
      modelAnswer: type === TestType.MEANING_TO_TERM ? w.term : w.meaning,
    }));
    const test = new Test({ testId, studentId, itemId, testType: type, questionCount: questions.length, createdAt: now(), questions });
    await this.testDAO.insert(test); await this.sync();
    return { test: (await this.testDAO.findById(testId))!, shortage: Math.max(0, n - words.length) };
  }

  /** G007 で作った送る内容（SendContent）を使い、AIで記述テストを作る */
  async createEssayTest(itemId: string, studentId: string, content: SendContent, count: number): Promise<Test> {
    if (!content.text.trim()) throw new TestError("先に「内容編集」で、送る内容を決めてください");
    const qs = await makeEssay(content.text, clampCount(count));
    if (!qs.length) throw new TestError("問題を作れませんでした。送る内容を見直してください");
    const testId = newId();
    const test = new Test({
      testId, studentId, itemId, testType: TestType.ESSAY, questionCount: qs.length, createdAt: now(),
      questions: qs.map((q, i) => new Question({ questionId: newId(), testId, studentId, number: i + 1, questionText: q.q, modelAnswer: q.a })),
    });
    await this.testDAO.insert(test); await this.sync();
    return (await this.testDAO.findById(testId))!;
  }

  /** テスト一覧を返す（G011、新しい順） */
  async getTests(itemId: string): Promise<Test[]> { return this.testDAO.findByItem(itemId); }

  /** テストを1つ返す（結果表示用） */
  async getTest(testId: string): Promise<Test> {
    const t = await this.testDAO.findById(testId); if (!t) throw new TestError("テストが見つかりません"); return t;
  }

  /**
   * 解答を受け取り、意味→用語のテストなら採点する。
   * 初回も解き直しも、解くたびに新しい Attempt（受験）として保存し、最終受験日時も更新する
   */
  async submitAnswers(testId: string, answers: string[]): Promise<Attempt> {
    const test = await this.getTest(testId), t = now();
    const attemptId = newId();
    const attempt = new Attempt({
      attemptId, testId, studentId: test.studentId, attemptNo: test.attempts.length + 1, takenAt: t,
      answers: test.questions.map((q, i) => new Answer({
        answerId: newId(), attemptId, questionId: q.questionId, studentId: test.studentId, studentAnswer: answers[i] ?? "", answeredAt: t,
        correct: test.testType === TestType.MEANING_TO_TERM ? this.gradeMeaningToTerm(answers[i] ?? "", q.modelAnswer) : null,
      })),
    });
    await this.testDAO.insertAttempt(attempt);
    await this.testDAO.updateLastTaken(testId, t);
    await this.sync();
    return attempt;
  }

  /** 同じ問題をもう一度出す（解いた結果は submitAnswers() で新しい受験として保存される） */
  async retry(testId: string): Promise<Question[]> { return (await this.getTest(testId)).questions; }

  /** そのテストの過去の受験をすべて返す（1回目から順に） */
  async getAttempts(testId: string): Promise<Attempt[]> { return this.testDAO.findAttempts(testId); }

  /** 「解説」ボタンを押したときだけAIで解説を作り、保存する。すでにあればそれを返す */
  async explain(testId: string, questionId: string): Promise<string> {
    const q = await this.question(testId, questionId);
    if (q.explanation) return q.explanation;
    return this.regenerateExplanation(testId, questionId, "");
  }

  // ---------- 1問ずつ直す（G010 と、G011 から開いた過去の結果） ----------

  /** 問題文と模範解答を手で書き直す（記述テストだけ。単語テストの間違いはノートの単語枠で直す） */
  async editQuestion(testId: string, questionId: string, questionText: string, modelAnswer: string): Promise<void> {
    const test = await this.getTest(testId);
    if (test.testType !== TestType.ESSAY) throw new TestError("単語テストの問題は、ノートの単語枠で直してください");
    if (!questionText.trim() || !modelAnswer.trim()) throw new TestError("問題文と模範解答を入力してください");
    await this.testDAO.updateQuestion(testId, questionId, questionText.trim(), modelAnswer.trim()); await this.sync();
  }

  /** AIに1問を作り直してもらう（記述テストだけ・1回分）。追加の指示が空なら、その問題を最初から作り直す */
  async regenerateQuestion(testId: string, questionId: string, extra: string): Promise<Question> {
    const test = await this.getTest(testId);
    if (test.testType !== TestType.ESSAY) throw new TestError("AIで作り直せるのは記述テストだけです");
    const q = await this.question(testId, questionId);
    checkLength(q.questionText + q.modelAnswer + extra);
    const r = await aiRegenerate({ q: q.questionText, a: q.modelAnswer }, extra.trim());
    await this.testDAO.updateQuestion(testId, questionId, r.q, r.a); await this.sync();
    return new Question({ ...q, questionText: r.q, modelAnswer: r.a });
  }

  /** 保存済みの自分の解答を、受験を指定して書き直す。採点がある「意味→用語」のテストでは使えない */
  async editAnswer(testId: string, attemptId: string, questionId: string, studentAnswer: string): Promise<void> {
    const test = await this.getTest(testId);
    if (!this.canEditAnswer(test.testType)) throw new TestError("「意味→用語」のテストは採点があるので、解答は直せません");
    await this.testDAO.updateAnswer(testId, attemptId, questionId, studentAnswer); await this.sync();
  }

  /** 解説を手で書き直す（すべてのテスト） */
  async editExplanation(testId: string, questionId: string, explanation: string): Promise<void> {
    await this.testDAO.updateExplanation(testId, questionId, explanation.trim()); await this.sync();
  }

  /** AIに解説を作り直してもらう（1回分）。追加の指示が空なら最初から作り直す */
  async regenerateExplanation(testId: string, questionId: string, extra: string): Promise<string> {
    const q = await this.question(testId, questionId);
    checkLength(q.questionText + q.modelAnswer + extra);
    const text = await aiExplain({ q: q.questionText, a: q.modelAnswer }, extra.trim());
    await this.testDAO.updateExplanation(testId, questionId, text); await this.sync();
    return text;
  }

  // ======== 移行中のつなぎ：画面のテスト（types.ts の Test）と beans の Test を変換する ========

  /** テストの種類：画面の書き方 → TestType */
  static typeOf(kind: TestKind): TestType {
    return kind === "w-m2t" ? TestType.MEANING_TO_TERM : kind === "w-t2m" ? TestType.TERM_TO_MEANING : TestType.ESSAY;
  }

  /** beans の Test を画面の形にする。解答と正誤は、いちばん新しい受験の分を入れる */
  toScreenTest(test: Test): ScreenTest {
    const kind: TestKind = test.testType === TestType.MEANING_TO_TERM ? "w-m2t" : test.testType === TestType.TERM_TO_MEANING ? "w-t2m" : "essay";
    const qs = [...test.questions].sort((a, b) => a.number - b.number);
    const last = [...test.attempts].sort((a, b) => b.attemptNo - a.attemptNo)[0];
    const answerOf = (questionId: string) => last?.answers.find(x => x.questionId === questionId);
    return {
      id: test.testId, itemId: test.itemId, kind, created: Date.parse(test.createdAt) || Date.now(),
      last: test.lastTakenAt ? Date.parse(test.lastTakenAt) : undefined,
      qs: qs.map(q => ({ q: q.questionText, a: q.modelAnswer, expl: q.explanation ?? undefined })),
      ans: last ? qs.map(q => answerOf(q.questionId)?.studentAnswer ?? "") : undefined,
      ok: last && test.testType === TestType.MEANING_TO_TERM ? qs.map(q => !!answerOf(q.questionId)?.correct) : undefined,
    };
  }

  /** 受験の一覧を画面の形にする（1回目から順に）。G010 で過去の受験を選ぶときに使う */
  toScreenAttempts(test: Test): ScreenAttempt[] {
    const qs = [...test.questions].sort((a, b) => a.number - b.number);
    return [...test.attempts].sort((a, b) => a.attemptNo - b.attemptNo).map(a => ({
      no: a.attemptNo, at: Date.parse(a.takenAt) || 0,
      ans: qs.map(q => a.answers.find(x => x.questionId === q.questionId)?.studentAnswer ?? ""),
      ok: test.testType === TestType.MEANING_TO_TERM ? qs.map(q => !!a.answers.find(x => x.questionId === q.questionId)?.correct) : undefined,
    }));
  }

  /** 何回目の受験かから受験IDを探す */
  async attemptIdOf(testId: string, attemptNo: number): Promise<string> {
    const a = (await this.getAttempts(testId)).find(x => x.attemptNo === attemptNo);
    if (!a) throw new TestError("その回の解答が見つかりません"); return a.attemptId;
  }

  /** 画面の問題番号（0から）から問題IDを探す */
  async questionIdAt(testId: string, index: number): Promise<string> {
    const q = [...(await this.getTest(testId)).questions].sort((a, b) => a.number - b.number)[index];
    if (!q) throw new TestError("問題が見つかりません"); return q.questionId;
  }

  /** 移行用：画面の古い保存場所にあるテストを、同じIDで入れる（解いたことがあれば、その解答も1回目の受験として入れる） */
  async importScreenTest(studentId: string, t: ScreenTest): Promise<boolean> {
    if (await this.testDAO.findById(t.id) || !t.qs.length) return false;
    const type = TestManager.typeOf(t.kind), created = new Date(t.created || Date.now()).toISOString();
    const questions = t.qs.map((q, i) => new Question({ questionId: newId(), testId: t.id, studentId, number: i + 1, questionText: q.q, modelAnswer: q.a, explanation: q.expl ?? null }));
    await this.testDAO.insert(new Test({ testId: t.id, studentId, itemId: t.itemId, testType: type, questionCount: questions.length, createdAt: created, questions }));
    if (t.ans) {
      const attemptId = newId(), at = new Date(t.last || t.created || Date.now()).toISOString();
      await this.testDAO.insertAttempt(new Attempt({
        attemptId, testId: t.id, studentId, attemptNo: 1, takenAt: at,
        answers: questions.map((q, i) => new Answer({ answerId: newId(), attemptId, questionId: q.questionId, studentId, studentAnswer: t.ans?.[i] ?? "", answeredAt: at, correct: type === TestType.MEANING_TO_TERM ? !!t.ok?.[i] : null })),
      }));
      await this.testDAO.updateLastTaken(t.id, at);
    }
    return true;
  }

  // ---------- private ----------

  /** 単語テストの「意味→用語」のときだけ使う。全角半角・大文字小文字・前後の空白を区別せず、完全一致で正誤を判定する */
  private gradeMeaningToTerm(input: string, modelAnswer: string): boolean {
    const norm = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
    return !!input.trim() && norm(input) === norm(modelAnswer);
  }
  /** 解答を直せる種類か。意味→用語なら false */
  private canEditAnswer(type: TestType): boolean { return type !== TestType.MEANING_TO_TERM; }

  /** 単語枠から、用語と意味が両方入っている単語を取り出す（partIds があればその枠だけ） */
  private async getWords(itemId: string, partIds?: string[]) {
    const note = await this.noteDAO.findByItem(itemId);
    return (note?.parts ?? []).filter(p => p.partType === PartType.FRAME && p.frameType === "word" && (!partIds || partIds.includes(p.partId)))
      .flatMap(p => p.words).filter(w => w.term.trim() && w.meaning.trim());
  }
  private async question(testId: string, questionId: string): Promise<Question> {
    const q = (await this.getTest(testId)).questions.find(x => x.questionId === questionId);
    if (!q) throw new TestError("問題が見つかりません"); return q;
  }
  /** 移行のあとにまとめて送る */
  syncNow() { return this.sync(); }
  private sync() { return pushQuietly(this.syncManager); }
}

/** 問題数は5〜20問 */
const clampCount = (n: number) => Math.min(20, Math.max(5, Math.round(n) || 10));
const checkLength = (s: string) => { if ([...s].length > SEND_LIMIT) throw new TestError("追加の指示が長すぎます（問題と合わせて1万文字まで）"); };