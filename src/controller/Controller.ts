// Controller（Controller／フロントエンド）：画面のボタン操作を受け取り、担当の Manager に仕事を渡す。
// イベントIDは外部設計書のイベント一覧表のとおり。W2 で画面を1つずつ handleRequest 経由に置き換えていく。
import type { El, Screen, Student, Subject as ScreenSubject, Test as ScreenTest, TestKind } from "../types";
import { ApiError, errorText } from "../services/api";
import { neonAuthClient } from "../boundary/NeonAuthClient";
import { AccountManager } from "../managers/AccountManager";
import { AppError } from "../managers/common";
import { SyncManager } from "../managers/SyncManager";
import { SendContentManager } from "../managers/SendContentManager";
import { AiSummaryManager } from "../managers/AiSummaryManager";
import { TestManager } from "../managers/TestManager";
import { TestType } from "../enums/TestType";
import { SubjectManager } from "../managers/SubjectManager";
import { LearningItemManager } from "../managers/LearningItemManager";
import { NoteManager } from "../managers/NoteManager";
import { SubjectDAO } from "../dao/SubjectDAO";
import { LearningItemDAO } from "../dao/LearningItemDAO";
import { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import { MaterialDAO } from "../dao/MaterialDAO";
import { NoteDAO } from "../dao/NoteDAO";
import { TestDAO } from "../dao/TestDAO";
import { SendContent } from "../beans/SendContent";

/** handleRequest の結果。next があれば画面を移る。error は画面に出す文 */
/** data は Manager が返したもの（作った科目など）。画面はこれを使って表示を変える */
export interface ControllerResult { next?: Screen; student?: Student | null; error?: string; data?: unknown }

export class Controller {
  readonly syncManager = new SyncManager(neonAuthClient);
  readonly accountManager = new AccountManager(neonAuthClient, this.syncManager); // ログインしたら pullAll() でデータを受け取る
  // ---- K・Nの分（画面からはまだ使っていない。W2 でAが画面をつなぐ） ----
  readonly materialDAO = new MaterialDAO();
  readonly noteDAO = new NoteDAO();
  readonly testDAO = new TestDAO();
  readonly sendContentManager = new SendContentManager(this.materialDAO, this.noteDAO);
  readonly aiSummaryManager = new AiSummaryManager(this.sendContentManager); // NoteManager は下の constructor で渡す
  readonly testManager = new TestManager(this.testDAO, this.noteDAO, this.syncManager);
  // ---- Aの分（11/11。G003・G004・ノートの保存・テスト（G008〜G011）から使い始めた） ----
  readonly subjectDAO = new SubjectDAO();
  readonly itemDAO = new LearningItemDAO();
  readonly prerequisiteDAO = new PrerequisiteDAO();
  readonly itemManager = new LearningItemManager(this.itemDAO, this.prerequisiteDAO, this.noteDAO, this.testDAO, this.materialDAO, this.syncManager);
  readonly subjectManager = new SubjectManager(this.subjectDAO, this.itemManager, this.syncManager);
  readonly noteManager = new NoteManager(this.noteDAO, this.syncManager);
  // Fさんが足す：materialManager

  constructor() {
    this.aiSummaryManager.setNoteManager(this.noteManager); // 承認したAIの提案を NoteManager でノートに反映する
  }

  /**
   * どの画面のどのボタンかを見て、担当の Manager を呼ぶ。
   * 例：G001 の login → AccountManager.login()
   */
  async handleRequest(screenId: Screen, eventId: string, params: Record<string, string> = {}): Promise<ControllerResult> {
    try {
      switch (`${screenId}:${eventId}`) {
        // ---- G001 ログイン画面 ----
        case "G001:login":
          return { next: "G003", student: await this.accountManager.login(params.mail ?? "", params.pass ?? "") };
        case "G001:frastLoginButton": // 新規登録画面へ
          return { next: "G002" };
        case "G001:googleLogin": // 外部設計書に追加が必要（Google でログイン）
        case "G002:googleLogin":
          await this.accountManager.loginWithGoogle(); // ページが Google に移動する
          return {};
        // ---- G002 アカウント登録画面 ----
        case "G002:frastloginbutton":
          return { next: "G003", student: await this.accountManager.register(params.mail ?? "", params.pass ?? "", params.passConfirm ?? "") };
        case "G002:back": // 外部設計書に追加が必要（ログインへ戻る）
          return { next: "G001" };
        // ---- G003 科目一覧画面 ----
        case "G003:addSubject": // 科目の追加
          return { data: await this.subjectManager.createSubject(params.studentId ?? "", params.name ?? "") };
        case "G003:renameSubject": // 名前の編集
          await this.subjectManager.renameSubject(params.studentId ?? "", params.subjectId ?? "", params.name ?? "");
          return {};
        case "G003:deleteSubject": // 削除（中の学習項目・ノート・テスト・資料も消える）
          await this.subjectManager.deleteSubject(params.subjectId ?? "");
          return { next: "G003" };
        // ---- G004 学習画面（学習項目・前提項目） ----
        case "G004:addItem": // 学習項目の追加（空のノートも一緒にできる）
          return { data: await this.itemManager.createItem(params.studentId ?? "", params.subjectId ?? "", params.name ?? "") };
        case "G004:renameItem": // 名前の編集
          await this.itemManager.renameItem(params.itemId ?? "", params.name ?? "");
          return {};
        case "G004:deleteItem": // 削除（ノート・テスト・資料も消え、ほかの項目の前提からも外れる）
          await this.itemManager.deleteItem(params.itemId ?? "");
          return {};
        case "G004:setPrerequisites": // 前提項目の設定の「確定」。prereqIds はカンマ区切り
          await this.itemManager.setPrerequisites(params.itemId ?? "", (params.prereqIds ?? "").split(",").filter(Boolean));
          return {};
        case "G004:saveNote": // ノートの「保存」（未保存のまま画面を移るときの「保存して移る」も）。els は画面の部品の JSON
          await this.noteManager.saveElements(params.studentId ?? "", params.itemId ?? "", JSON.parse(params.els ?? "[]") as El[]);
          return {};
        // ---- G008 テスト作成 ----
        case "G008:createWordTest": { // 単語テスト（AIを使わない）。partIds は「枠を選ぶ」のときだけ、カンマ区切り
          const type = TestManager.typeOf(params.kind as TestKind) as TestType.MEANING_TO_TERM | TestType.TERM_TO_MEANING;
          const partIds = params.partIds ? params.partIds.split(",").filter(Boolean) : undefined;
          const r = await this.testManager.createWordTest(params.itemId ?? "", params.studentId ?? "", type, Number(params.count), partIds);
          return { data: { test: this.testManager.toScreenTest(r.test), shortage: r.shortage } };
        }
        case "G008:createEssayTest": // 記述テスト（AIで作る）。text は G007 で決めた送る内容
          return { data: this.testManager.toScreenTest(await this.testManager.createEssayTest(params.itemId ?? "", params.studentId ?? "", new SendContent({ text: params.text ?? "", charCount: (params.text ?? "").length }), Number(params.count))) };
        // ---- G009 テスト解答 ----
        case "G009:submit": { // 解答：初回も解き直しも、新しい受験として保存して採点する。answers は解答の JSON
          const testId = params.testId ?? "";
          await this.testManager.submitAnswers(testId, JSON.parse(params.answers ?? "[]") as string[]);
          return { data: this.testManager.toScreenTest(await this.testManager.getTest(testId)) };
        }
        // ---- G010 テスト結果 ----
        case "G010:explain": { // 解説（AI）。index は画面の問題番号（0から）
          const testId = params.testId ?? "";
          return { data: await this.testManager.explain(testId, await this.testManager.questionIdAt(testId, Number(params.index))) };
        }
        case "G010:getAttempts": // 過去の受験の一覧（1回目から順に）
          return { data: this.testManager.toScreenAttempts(await this.testManager.getTest(params.testId ?? "")) };
        // ---- G010 テストを直す（index は画面の問題番号（0から）） ----
        case "G010:editQuestion": { // 問題と模範解答を手で直す（記述テストだけ）
          const testId = params.testId ?? "";
          await this.testManager.editQuestion(testId, await this.testManager.questionIdAt(testId, Number(params.index)), params.question ?? "", params.modelAnswer ?? "");
          return { data: this.testManager.toScreenTest(await this.testManager.getTest(testId)) };
        }
        case "G010:regenerateQuestion": { // 問題と模範解答をAIで作り直す（記述テストだけ・1回分）。extra は追加の指示
          const testId = params.testId ?? "";
          await this.testManager.regenerateQuestion(testId, await this.testManager.questionIdAt(testId, Number(params.index)), params.extra ?? "");
          return { data: this.testManager.toScreenTest(await this.testManager.getTest(testId)) };
        }
        case "G010:editAnswer": { // 自分の解答を直す（「意味→用語」以外）。attemptNo は何回目の受験か
          const testId = params.testId ?? "";
          await this.testManager.editAnswer(testId, await this.testManager.attemptIdOf(testId, Number(params.attemptNo)), await this.testManager.questionIdAt(testId, Number(params.index)), params.answer ?? "");
          const test = await this.testManager.getTest(testId);
          return { data: { test: this.testManager.toScreenTest(test), attempts: this.testManager.toScreenAttempts(test) } };
        }
        case "G010:editExplanation": { // 解説を手で直す
          const testId = params.testId ?? "";
          await this.testManager.editExplanation(testId, await this.testManager.questionIdAt(testId, Number(params.index)), params.explanation ?? "");
          return { data: this.testManager.toScreenTest(await this.testManager.getTest(testId)) };
        }
        case "G010:regenerateExplanation": { // 解説をAIで作り直す（1回分）。extra は追加の指示
          const testId = params.testId ?? "";
          await this.testManager.regenerateExplanation(testId, await this.testManager.questionIdAt(testId, Number(params.index)), params.extra ?? "");
          return { data: this.testManager.toScreenTest(await this.testManager.getTest(testId)) };
        }
        // ---- ログインした直後：端末のデータベース（アカウントから受け取った分）を、画面の形にして返す ----
        // この端末で初めてなら、前の保存場所（local）のデータを先に Manager に移す（1回だけ）
        case "G003:loadSubjects": {
          const sid = params.studentId ?? "";
          await this.migrateOnce(sid, JSON.parse(params.local ?? "[]") as ScreenSubject[], JSON.parse(params.localTests ?? "[]") as ScreenTest[]);
          const subjects = await this.loadScreenSubjects(sid);
          return { data: { subjects, tests: await this.loadScreenTests(subjects) } };
        }
      }
      // ---- ログアウト（ヘッダーのボタンなので、どの画面からでも） ----
      if (eventId === "logoutButton") { await this.accountManager.logout(); return { next: "G001", student: null }; }
      return { error: `まだ作っていない操作です（${screenId}:${eventId}）` };
    } catch (e) {
      // Manager のエラー（AppError）は文をそのまま画面に出す
      if (e instanceof ApiError) return { error: errorText(e) }; // AIのサーバーのエラー（回数切れ・長すぎるなど）
      return { error: e instanceof AppError ? e.message : "うまくいきませんでした。時間をおいて試してください" };
    }
  }

  /**
   * 移行中のつなぎ：画面の前の保存場所（localStorage）にある科目・学習項目・前提項目・保存済みのノートを、
   * この端末・この学生で1回だけ Manager に移す。2回目からは移さない
   * （移し直すと、別の端末で消したものが戻ってきてしまうため）
   */
  private async migrateOnce(studentId: string, local: ScreenSubject[], localTests: ScreenTest[]): Promise<void> {
    if (!studentId) return;
    if (!(await this.subjectManager.isMigrated(studentId))) {
      await this.subjectManager.importSubjects(studentId, local.map(s => ({ id: s.id, name: s.name })));
      for (const s of local) {
        await this.itemManager.importItems(studentId, s.id, s.items.map(i => ({ id: i.id, name: i.name, prereqs: i.prereqs })));
        for (const i of s.items) await this.noteManager.importNote(studentId, i.id, i.note.els, i.note.savedAt);
      }
      await this.subjectManager.setMigrated(studentId);
    }
    // テストは 11/12 の後から移すので、印を分けてある。学習項目がある分だけ移す
    if (!(await this.subjectManager.isMigrated(studentId, "tests"))) {
      const itemIds = new Set<string>();
      for (const s of await this.subjectManager.getSubjects(studentId)) for (const i of await this.itemManager.getItems(s.subjectId)) itemIds.add(i.itemId);
      let added = 0;
      for (const t of localTests) if (itemIds.has(t.itemId) && await this.testManager.importScreenTest(studentId, t)) added++;
      if (added) await this.testManager.syncNow();
      await this.subjectManager.setMigrated(studentId, "tests");
    }
  }

  /** 移行中のつなぎ：画面に出している学習項目のテストを、画面の形にして返す */
  private async loadScreenTests(subjects: ScreenSubject[]): Promise<ScreenTest[]> {
    const out: ScreenTest[] = [];
    for (const s of subjects) for (const i of s.items) for (const t of await this.testManager.getTests(i.id)) out.push(this.testManager.toScreenTest(t));
    return out;
  }

  /**
   * 移行中のつなぎ：科目・学習項目・前提項目・ノートを Manager から読み、画面の形（types.ts の Subject）にする。
   * 別の端末で作った分も、ログインしたときに画面に出せるようにするため
   */
  private async loadScreenSubjects(studentId: string): Promise<ScreenSubject[]> {
    const out: ScreenSubject[] = [];
    for (const sub of await this.subjectManager.getSubjects(studentId)) {
      const { items, prerequisites } = await this.itemManager.getRelationMap(sub.subjectId);
      const its: ScreenSubject["items"] = [];
      for (const it of items) {
        const note = await this.noteManager.getNote(it.itemId, studentId);
        its.push({
          id: it.itemId, name: it.itemName,
          prereqs: prerequisites.filter(p => p.itemId === it.itemId).map(p => p.prereqItemId),
          note: { els: this.noteManager.toElements(note), savedAt: note.lastSavedAt ? Date.parse(note.lastSavedAt) : 0 },
        });
      }
      out.push({ id: sub.subjectId, name: sub.subjectName, items: its });
    }
    return out;
  }
}

/** アプリ全体で1つだけ使う Controller */
export const controller = new Controller();