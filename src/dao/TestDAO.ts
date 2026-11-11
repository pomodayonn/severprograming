// TestDAO（DAO／フロントエンド）：テストを問題・受験・解答ごと端末（IndexedDB）に保存・読み込みする
// 
// テストは「問題・受験・解答」を中に持ったまま1件として保存する。中のどれかが変わったらテストの更新日時も変える（同期で送るため）
import { Test } from "../beans/Test";
import { Question } from "../beans/Question";
import { Attempt } from "../beans/Attempt";
import { Answer } from "../beans/Answer";
import { now } from "../beans/DateTime";
import { del, get, getAllBy, put } from "./idb";

const toTest = (r: Test): Test => new Test({
  ...r,
  questions: (r.questions ?? []).map(q => new Question(q)).sort((a, b) => a.number - b.number),
  attempts: (r.attempts ?? []).map(a => new Attempt({ ...a, answers: (a.answers ?? []).map(x => new Answer(x)) })).sort((a, b) => a.attemptNo - b.attemptNo),
});

export class TestDAO {
  /** その学習項目のテストを、新しい順に返す */
  async findByItem(itemId: string): Promise<Test[]> {
    const rows = await getAllBy<Test>("tests", "itemId", itemId);
    return rows.map(toTest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** テストを1つ返す（なければ null） */
  async findById(testId: string): Promise<Test | null> {
    const r = await get<Test>("tests", testId); return r ? toTest(r) : null;
  }
  /** テストを問題ごと保存する */
  async insert(test: Test): Promise<void> {
    const t = now();
    await put("tests", new Test({
      ...test, createdAt: test.createdAt || t, updatedAt: t, questionCount: test.questions.length,
      questions: test.questions.map(q => new Question({ ...q, studentId: test.studentId, testId: test.testId, updatedAt: t })),
      attempts: [],
    }));
  }
  /** 1回分の受験を、解答ごと保存する（初回も解き直しも） */
  async insertAttempt(attempt: Attempt): Promise<void> {
    await this.change(attempt.testId, (test, t) => {
      test.attempts = [...test.attempts.filter(a => a.attemptId !== attempt.attemptId), new Attempt({
        ...attempt, studentId: test.studentId, updatedAt: t,
        answers: attempt.answers.map(x => new Answer({ ...x, studentId: test.studentId, attemptId: attempt.attemptId, updatedAt: t })),
      })];
    });
  }
  /** そのテストの受験をすべて読み込む（1回目から順に） */
  async findAttempts(testId: string): Promise<Attempt[]> {
    return (await this.findById(testId))?.attempts ?? [];
  }
  /** 解説を保存する（作ったとき・直したとき） */
  async updateExplanation(testId: string, questionId: string, explanation: string): Promise<void> {
    await this.change(testId, (test, t) => { test.questions = test.questions.map(q => q.questionId === questionId ? new Question({ ...q, explanation, updatedAt: t }) : q); });
  }
  /** 直した問題文と模範解答を保存する */
  async updateQuestion(testId: string, questionId: string, questionText: string, modelAnswer: string): Promise<void> {
    await this.change(testId, (test, t) => { test.questions = test.questions.map(q => q.questionId === questionId ? new Question({ ...q, questionText, modelAnswer, updatedAt: t }) : q); });
  }
  /** 直した自分の解答を保存する */
  async updateAnswer(testId: string, attemptId: string, questionId: string, studentAnswer: string): Promise<void> {
    await this.change(testId, (test, t) => {
      test.attempts = test.attempts.map(a => a.attemptId !== attemptId ? a : new Attempt({
        ...a, updatedAt: t, answers: a.answers.map(x => x.questionId === questionId ? new Answer({ ...x, studentAnswer, updatedAt: t }) : x),
      }));
    });
  }
  /** 最終受験日時を更新する */
  async updateLastTaken(testId: string, at: string = now()): Promise<void> {
    await this.change(testId, test => { test.lastTakenAt = at; });
  }
  /** 学習項目を作ったときに、空のテストフォルダを作る。テストは学習項目IDでまとまるので、端末では入れ物を作る必要はない */
  async createTestFolder(_itemId: string): Promise<void> { /* 何もしない（クラス設計に合わせて用意） */ }
  /** 学習項目を消したときに、テストフォルダを中のテストごと消す（Neon では学習項目と一緒に消える） */
  async deleteTestFolder(itemId: string): Promise<void> {
    for (const t of await getAllBy<Test>("tests", "itemId", itemId)) await del("tests", t.testId);
  }

  /** テストを読み込んで書き換え、更新日時を新しくして保存する */
  private async change(testId: string, f: (test: Test, t: string) => void): Promise<void> {
    const test = await this.findById(testId); if (!test) throw new Error("テストが見つかりません");
    const t = now(); f(test, t); test.updatedAt = t;
    await put("tests", test);
  }
}