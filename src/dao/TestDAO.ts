// TestDAO（DAO／フロントエンド）：テストを問題・受験・解答ごと端末（IndexedDB）に保存・読み込みする
// 
// テストは「問題・受験・解答」を中に持ったまま1件として保存する。中のどれかが変わったらテストの更新日時も変える（同期で送るため）
//
// 【このファイルで何が起きているか】
// テスト（中の問題・受験・解答ごと1件にまとめて）を、端末の IndexedDB（dao/idb.ts）に保存したり読み出したりする係（DAO）です。
// DAO は「しまう・取り出す」だけをして、名前が正しいかなどの確認は Manager（TestManager）がする。
// 流れ：画面 → Controller → TestManager → ここ → IndexedDB
// 保存すると updatedAt（更新日時）が新しくなり、SyncManager がそれを見て Neon（クラウド）に送る
// Neon では test・question・attempt・answer の4つの表に分かれる
import { Test } from "../beans/Test";
import { Question } from "../beans/Question";
import { Attempt } from "../beans/Attempt";
import { Answer } from "../beans/Answer";
import { now } from "../beans/DateTime";
import {
  del,
  get,
  getAllBy,
  put,
  recordDeletion,
  editStoredTest,
} from "./idb";

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
   /**
   * 受験番号を確定し、受験履歴と最終受験日時を
   * 同時に保存する。
   */
  async insertAttempt(
    testId: string,
    build: (test: Test, t: string) => Attempt
  ): Promise<Attempt> {
    return this.change(testId, (test, t) => {
      const attempt = build(test, t);

      const nextNo = Math.max(
        0,
        ...test.attempts.map(a => a.attemptNo)
      ) + 1;

      const saved = new Attempt({
        ...attempt,
        testId,
        studentId: test.studentId,
        attemptNo: nextNo,
        updatedAt: t,

        answers: attempt.answers.map(x =>
          new Answer({
            ...x,
            studentId: test.studentId,
            attemptId: attempt.attemptId,
            updatedAt: t,
          })
        ),
      });

      test.attempts = [
        ...test.attempts,
        saved,
      ];

      test.lastTakenAt = saved.takenAt;

      return saved;
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
    /**
   * 直した問題文と模範解答を保存する。
   * 内容が変更された場合は、古い解説を初期化する。
   */
  async updateQuestion(
    testId: string,
    questionId: string,
    questionText: string,
    modelAnswer: string
  ): Promise<void> {
    await this.change(testId, (test, t) => {
      test.questions = test.questions.map(q => {
        if (q.questionId !== questionId) {
          return q;
        }

        const changed =
          q.questionText !== questionText ||
          q.modelAnswer !== modelAnswer;

        return new Question({
          ...q,
          questionText,
          modelAnswer,
          explanation: changed ? null : q.explanation,// 内容が変わったら解説を初期化する
          updatedAt: t,
        });
      });
    });
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
  /** テストを1つ、問題・受験・解答ごと消す（11/23）。Neon では test を消すと question・attempt・answer も一緒に消える */
  async delete(testId: string): Promise<void> {
    const t = await get<Test>("tests", testId); if (!t) return;
    await del("tests", testId);
    await recordDeletion("test", testId, t.studentId);
  }
  /** 学習項目を消したときに、テストフォルダを中のテストごと消す（Neon では学習項目と一緒に消える） */
  async deleteTestFolder(itemId: string): Promise<void> {
    for (const t of await getAllBy<Test>("tests", "itemId", itemId)) await del("tests", t.testId);
  }

  /** テストの読み込み・変更・保存を一括処理する */
  private async change<T>(
    testId: string,
    f: (test: Test, t: string) => T
  ): Promise<T> {
    return editStoredTest(testId, row => {
      const test = toTest(row);
      const t = now();

      const result = f(test, t);

      test.updatedAt = t;

      return {
        test,
        result,
      };
    });
  }
}
