// Controller（Controller／フロントエンド）：画面のボタン操作を受け取り、担当の Manager に仕事を渡す。
// イベントIDは外部設計書のイベント一覧表のとおり。W2 で画面を1つずつ handleRequest 経由に置き換えていく。
//
// 【このファイルで何が起きているか】
// 画面とプログラムの中身をつなぐ「受付」です（Controller）。どの画面のボタンも、まずここに来る。
// 流れ（例：科目の追加）
//   画面（SubjectList.tsx）が controller.handleRequest("G003", "addSubject", { studentId, name: "数学" }) を呼ぶ
//   → 下の switch で "G003:addSubject" を見つける
//   → 担当の SubjectManager.createSubject に仕事を渡す
//   → 結果を { data } で、エラーなら { error: "画面に出す文" } で画面に返す
// 画面は Manager や DAO を直接さわらず、必ずここを通る（設計書の「画面 → Controller → Manager → DAO」）。
//
// 11/21 リファクタリング：params（画面から渡すもの）の形を、イベントごとに RequestParams で決めた。
//   前はすべて文字列だったので、配列は JSON にしたりカンマでつないだり、数は String() で文字にしたりしていた。
//   いまは配列・数・true/false をそのまま渡せて、イベントIDや名前を打ち間違えると型チェック（npm run build）で分かる。
//   Java でいうと、メソッドの引数に型を書いておくのと同じ
// 11/21 道B：画面も beans（Subject・LearningItem・Note・NotePart・Test・Question・Attempt・Material・Suggestion）をそのまま使うようにした。
//   前は「画面用の形」と「保存用の形（beans）」が別々にあり、ここで行き来のたびに変換していた（toScreenTest・toElements など）。
//   今は Manager が返した beans をそのまま画面に返す。画面が問題ID・受験IDを持っているので、探し直しもしない
import type { FrameType, Screen } from "../types";
import type { Student } from "../beans/Student";
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
import { NoteManager, type TocEntry } from "../managers/NoteManager";
import { MaterialManager } from "../managers/MaterialManager";
import type { ProgressListener } from "../interfaces/ProgressListener";
import { SubjectDAO } from "../dao/SubjectDAO";
import { LearningItemDAO } from "../dao/LearningItemDAO";
import { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import { MaterialDAO } from "../dao/MaterialDAO";
import { NoteDAO } from "../dao/NoteDAO";
import { TestDAO } from "../dao/TestDAO";
import { SendContent } from "../beans/SendContent";
import type { Suggestion } from "../beans/Suggestion";
import { Note } from "../beans/Note";
import type { NotePart } from "../beans/NotePart";
import type { Subject } from "../beans/Subject";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import type { Test } from "../beans/Test";
import type { Material } from "../beans/Material";

/** handleRequest の結果。next があれば画面を移る。error は画面に出す文 */
/** data は Manager が返したもの（作った科目など）。画面はこれを使って表示を変える */
export interface ControllerResult { next?: Screen; student?: Student | null; error?: string; data?: unknown }
/**
 * 文字列では渡せないもの（handleRequest の4つ目の引数）。資料の追加と文字起こしで使う
 * ・file    ：追加するファイル（G004:uploadMaterial）
 * ・listener：文字起こしの進み具合を受け取る係（G004:transcribe。Java の ActionListener と同じ考え方）
 */
export interface ControllerExtra { file?: File; listener?: ProgressListener }

/** 何も渡さないイベント */
type NoParams = Record<string, never>;
/** ログアウトのとき（どちらも省略したら false） */
type LogoutParams = { clearLocal?: boolean; force?: boolean };
/** G010 で1問を指定するとき（問題ID） */
type QuestionOf = { testId: string; questionId: string };

/** G003:loadSubjects で返すもの：その学生のデータを、beans のまま種類ごとに並べたもの */
export interface StudentData {
  subjects: Subject[]; items: LearningItem[]; prerequisites: Prerequisite[]; notes: Note[]; tests: Test[]; materials: Material[];
}

/**
 * 「画面ID:イベントID」ごとに、params に入れるものを決めた表。
 * ここにないイベントIDや、名前・型の違う params を渡すと、型チェックでエラーになる
 */
export type RequestParams = {
  "G001:login": { mail: string; pass: string };
  "G001:frastLoginButton": NoParams; // 新規登録画面へ
  "G001:googleLogin": NoParams;
  "G002:googleLogin": NoParams;
  "G002:frastloginbutton": { mail: string; pass: string; passConfirm: string }; // 登録
  "G002:back": NoParams;
  "G003:loadSubjects": { studentId: string };
  "G003:addSubject": { studentId: string; name: string };
  "G003:renameSubject": { studentId: string; subjectId: string; name: string };
  "G003:deleteSubject": { subjectId: string };
  "G004:addItem": { studentId: string; subjectId: string; name: string };
  "G004:renameItem": { itemId: string; name: string };
  "G004:deleteItem": { itemId: string };
  "G004:setPrerequisites": { itemId: string; prereqIds: string[] };
  "G004:uploadMaterial": { itemId: string };
  "G004:transcribe": { materialId: string };
  "G004:getContent": { materialId: string };
  "G005:getContent": { materialId: string };
  "G006:getContent": { materialId: string };
  "G007:getContent": { materialId: string };
  "G005:deleteMaterial": { materialId: string; withTranscript: boolean };
  "G006:correctTranscript": { materialId: string; text: string };
  "G004:saveNote": { studentId: string; itemId: string; parts: readonly NotePart[] };
  "G007:summarize": { studentId: string; itemId: string; text: string; frameTypes: FrameType[]; parts: readonly NotePart[] };
  "G007:approve": { studentId: string; itemId: string; parts: readonly NotePart[]; suggestions: Suggestion[] };
  "G008:createWordTest": { studentId: string; itemId: string; testType: TestType.MEANING_TO_TERM | TestType.TERM_TO_MEANING; count: number; partIds?: string[] };
  "G008:createEssayTest": { studentId: string; itemId: string; text: string; count: number };
  "G009:submit": { testId: string; answers: string[] };
  "G010:explain": QuestionOf;
  "G010:getAttempts": { testId: string };
  "G010:editQuestion": QuestionOf & { question: string; modelAnswer: string };
  "G010:regenerateQuestion": QuestionOf & { extra: string };
  "G010:editAnswer": QuestionOf & { attemptId: string; answer: string };
  "G010:editExplanation": QuestionOf & { explanation: string };
  "G010:regenerateExplanation": QuestionOf & { extra: string };
  "G011:deleteTest": { testIds: string[] };
} & {
  // ログアウトはヘッダーのボタンなので、どの画面からでも。clearLocal：この端末のデータも消すか、force：送れていない変更があっても消すか
  [S in Screen as `${S}:logoutButton`]: LogoutParams;
} & {
  // 「最新にする」もヘッダーのボタンなので、どの画面からでも（11/23）
  [S in Screen as `${S}:refreshButton`]: NoParams;
};
type RequestKey = keyof RequestParams;
/** 画面 S で使えるイベントID */
export type EventOf<S extends Screen> = { [K in RequestKey]: K extends `${S}:${infer E}` ? E : never }[RequestKey];
/** 画面 S・イベント E の params の形 */
export type ParamsOf<S extends Screen, E extends string> = RequestParams[`${S}:${E}` & RequestKey];

export class Controller {
  readonly syncManager = new SyncManager(neonAuthClient);
  readonly accountManager = new AccountManager(neonAuthClient, this.syncManager); // ログインしたら pullAll() でデータを受け取る
  readonly materialDAO = new MaterialDAO();
  readonly noteDAO = new NoteDAO();
  readonly testDAO = new TestDAO();
  readonly subjectDAO = new SubjectDAO();
  readonly itemDAO = new LearningItemDAO();
  readonly prerequisiteDAO = new PrerequisiteDAO();
  // NoteManager は TestManager（単語テストの単語）と AiSummaryManager（提案の反映）が使うので、先に作る
  readonly noteManager = new NoteManager(this.noteDAO, this.syncManager);
  readonly sendContentManager = new SendContentManager();
  readonly aiSummaryManager = new AiSummaryManager(this.sendContentManager, this.noteManager); // 承認したAIの提案を NoteManager でノートに反映する
  readonly testManager = new TestManager(this.testDAO, this.noteManager, this.syncManager);
  readonly itemManager = new LearningItemManager(this.itemDAO, this.prerequisiteDAO, this.noteDAO, this.testDAO, this.materialDAO, this.syncManager);
  readonly subjectManager = new SubjectManager(this.subjectDAO, this.itemManager, this.syncManager);
  readonly materialManager = new MaterialManager(this.materialDAO); // 11/21（福山）：資料と文字起こし

  constructor() {
    // 11/17：オフラインから戻ったら、その間に保存した分をアカウント（Neon）に送る
    if (typeof window !== "undefined") window.addEventListener("online", () => { void this.syncManager.pushChanges().catch(() => {}); });
  }

  /**
   * どの画面のどのボタンかを見て、担当の Manager を呼ぶ。
   * 例：G001 の login → AccountManager.login()
   */
  async handleRequest<S extends Screen, E extends EventOf<S>>(screenId: S, eventId: E, params?: ParamsOf<S, E>, extra: ControllerExtra = {}): Promise<ControllerResult> {
    const key = `${screenId}:${eventId}` as RequestKey;
    // switch の中では、その case の params の形として読む（Java のキャストと同じ）
    const p = <K extends RequestKey>(_: K) => (params ?? {}) as RequestParams[K];
    try {
      switch (key) {
        // ---- G001 ログイン画面 ----
        case "G001:login": {
          const { mail, pass } = p("G001:login");
          return { next: "G003", student: await this.accountManager.login(mail, pass) };
        }
        case "G001:frastLoginButton": // 新規登録画面へ
          return { next: "G002" };
        case "G001:googleLogin": // 外部設計書に追加が必要（Google でログイン）
        case "G002:googleLogin":
          await this.accountManager.loginWithGoogle(); // ページが Google に移動する
          return {};
        // ---- G002 アカウント登録画面 ----
        case "G002:frastloginbutton": {
          const { mail, pass, passConfirm } = p("G002:frastloginbutton");
          return { next: "G003", student: await this.accountManager.register(mail, pass, passConfirm) };
        }
        case "G002:back": // 外部設計書に追加が必要（ログインへ戻る）
          return { next: "G001" };
        // ---- G003 科目一覧画面 ----
        case "G003:addSubject": { // 科目の追加
          const { studentId, name } = p("G003:addSubject");
          return { data: await this.subjectManager.createSubject(studentId, name) };
        }
        case "G003:renameSubject": { // 名前の編集
          const { studentId, subjectId, name } = p("G003:renameSubject");
          await this.subjectManager.renameSubject(studentId, subjectId, name);
          return {};
        }
        case "G003:deleteSubject": // 削除（中の学習項目・ノート・テスト・資料も消える）
          await this.subjectManager.deleteSubject(p("G003:deleteSubject").subjectId);
          return { next: "G003" };
        // ---- G004 学習画面（学習項目・前提項目） ----
        case "G004:addItem": { // 学習項目の追加（空のノートも一緒にできる）
          const { studentId, subjectId, name } = p("G004:addItem");
          return { data: await this.itemManager.createItem(studentId, subjectId, name) };
        }
        case "G004:renameItem": { // 名前の編集
          const { itemId, name } = p("G004:renameItem");
          await this.itemManager.renameItem(itemId, name);
          return {};
        }
        case "G004:deleteItem": // 削除（ノート・テスト・資料も消え、ほかの項目の前提からも外れる）
          await this.itemManager.deleteItem(p("G004:deleteItem").itemId);
          return {};
        case "G004:setPrerequisites": { // 前提項目の設定の「確定」
          const { itemId, prereqIds } = p("G004:setPrerequisites");
          await this.itemManager.setPrerequisites(itemId, prereqIds);
          return {};
        }
        // ---- G004 学習画面（資料）・G005 資料表示・G006 文字起こし修正（11/21 福山：MaterialManager） ----
        case "G004:uploadMaterial": { // 「＋ 資料の追加」：ファイルは extra.file。保存した資料を返す（文字起こしは続けて G004:transcribe）
          if (!extra.file) return { error: "ファイルを選んでください" };
          return { data: await this.materialManager.upload(p("G004:uploadMaterial").itemId, extra.file) };
        }
        case "G004:transcribe": { // 文字起こし：進み具合は extra.listener に知らせる。できた .txt と、読み取れなかったページを返す
          return { data: await this.materialManager.transcribe(p("G004:transcribe").materialId, extra.listener ?? { onProgress: () => {} }) };
        }
        case "G004:getContent": // 資料の中身（学習画面の「資料と並べる」・資料表示・文字起こし修正・AIに送る内容で使う）
        case "G005:getContent":
        case "G006:getContent":
        case "G007:getContent":
          return { data: await this.materialManager.getContent(p("G004:getContent").materialId) };
        case "G005:deleteMaterial": { // 資料の削除。withTranscript が true なら、この資料から作った文字起こしも消す
          const { materialId, withTranscript } = p("G005:deleteMaterial");
          await this.materialManager.delete(materialId, withTranscript);
          return {};
        }
        case "G006:correctTranscript": { // 文字起こし修正の「確定」
          const { materialId, text } = p("G006:correctTranscript");
          await this.materialManager.correctTranscript(materialId, text);
          return {};
        }
        case "G004:saveNote": { // ノートの「保存」（未保存のまま画面を移るときの「保存して移る」も）。parts は下書きの部品
          const { studentId, itemId, parts } = p("G004:saveNote");
          await this.noteManager.saveParts(studentId, itemId, parts);
          return {};
        }
        // ---- G008 テスト作成 ----
        case "G008:createWordTest": { // 単語テスト（AIを使わない）。partIds は「枠を選ぶ」のときだけ
          const { studentId, itemId, testType, count, partIds } = p("G008:createWordTest");
          return { data: await this.testManager.createWordTest(itemId, studentId, testType, count, partIds) }; // { test, shortage }
        }
        // ---- G007 送信内容・提案確認（AIまとめ） ----
        case "G007:summarize": { // 送信：AIに送って提案（Suggestion）をもらう。parts は今のノート（下書き）
          const { studentId, itemId, text, frameTypes, parts } = p("G007:summarize");
          return { data: await this.aiSummaryManager.summarize(sendContentOf(text), await this.draftNote(studentId, itemId, parts), frameTypes) };
        }
        case "G007:approve": { // 承認：選んだ提案を入れたノートの部品を返す（保存はしない。学習画面の「保存」で保存する）
          const { studentId, itemId, parts, suggestions } = p("G007:approve");
          return { data: this.aiSummaryManager.mergeApproved(await this.draftNote(studentId, itemId, parts), suggestions).parts };
        }
        case "G008:createEssayTest": { // 記述テスト（AIで作る）。text は G007 で決めた送る内容
          const { studentId, itemId, text, count } = p("G008:createEssayTest");
          return { data: await this.testManager.createEssayTest(itemId, studentId, sendContentOf(text), count) };
        }
        // ---- G009 テスト解答 ----
        case "G009:submit": { // 解答：初回も解き直しも、新しい受験として保存して採点する
          const { testId, answers } = p("G009:submit");
          return { data: await this.testManager.submitAnswers(testId, answers) }; // 保存した受験（Attempt）
        }
        // ---- G010 テスト結果 ----
        case "G010:explain": { // 解説（AI）。すでにあれば保存してある解説を返す
          const { testId, questionId } = p("G010:explain");
          return { data: await this.testManager.explain(testId, questionId) };
        }
        case "G010:getAttempts": // 過去の受験の一覧（1回目から順に）
          return { data: await this.testManager.getAttempts(p("G010:getAttempts").testId) };
        // ---- G010 テストを直す ----
        case "G010:editQuestion": { // 問題と模範解答を手で直す（記述テストだけ）
          const { testId, questionId, question, modelAnswer } = p("G010:editQuestion");
          await this.testManager.editQuestion(testId, questionId, question, modelAnswer);
          return {};
        }
        case "G010:regenerateQuestion": { // 問題と模範解答をAIで作り直す（記述テストだけ・1回分）。extra は追加の指示。作り直した問題を返す
          const { testId, questionId, extra: ins } = p("G010:regenerateQuestion");
          return { data: await this.testManager.regenerateQuestion(testId, questionId, ins) };
        }
        case "G010:editAnswer": { // 自分の解答を直す（「意味→用語」以外）。attemptId はどの回の受験か
          const { testId, attemptId, questionId, answer } = p("G010:editAnswer");
          await this.testManager.editAnswer(testId, attemptId, questionId, answer);
          return {};
        }
        case "G010:editExplanation": { // 解説を手で直す
          const { testId, questionId, explanation } = p("G010:editExplanation");
          await this.testManager.editExplanation(testId, questionId, explanation);
          return {};
        }
        case "G010:regenerateExplanation": { // 解説をAIで作り直す（1回分）。extra は追加の指示。作り直した解説を返す
          const { testId, questionId, extra: ins } = p("G010:regenerateExplanation");
          return { data: await this.testManager.regenerateExplanation(testId, questionId, ins) };
        }
        // ---- G011 テスト一覧 ----
        case "G011:deleteTest": { // 削除（11/23）。選んだテストを、問題・受験・解答ごと消す（まとめて消すときは複数）
          await this.testManager.deleteTests(p("G011:deleteTest").testIds);
          return {};
        }
        // ---- ログインした直後・保存したあと：端末のデータベース（アカウントから受け取った分）を beans のまま返す ----
        case "G003:loadSubjects":
          return { data: await this.loadStudentData(p("G003:loadSubjects").studentId) };
      }
      // ---- ログアウト（ヘッダーのボタンなので、どの画面からでも） ----
      // 送れていない変更があって消すのを止めたときは、ログアウトせずに data で unsent を返す（画面が確認を出す）
      // ---- 最新にする（ヘッダーのボタン。11/23）：30分たっていなくても、アカウントのデータを受け取り直す ----
      if (eventId === "refreshButton") {
        await this.accountManager.refresh();
        return {};
      }
      if (eventId === "logoutButton") {
        const { clearLocal = false, force = false } = (params ?? {}) as LogoutParams;
        if (await this.accountManager.logout(clearLocal, force) === "unsent") return { data: { unsent: true } };
        return { next: "G001", student: null };
      }
      return { error: `まだ作っていない操作です（${key}）` };
    } catch (e) {
      // Manager のエラー（AppError）は文をそのまま画面に出す
      if (e instanceof ApiError) return { error: errorText(e) }; // AIのサーバーのエラー（回数切れ・長すぎるなど）
      return { error: e instanceof AppError ? e.message : "うまくいきませんでした。時間をおいて試してください" };
    }
  }

  // ---- 画面を描いている最中に、すぐ結果がほしいもの ----
  // handleRequest は async（結果を待つ）なので、ドラッグ中や描画中には使いにくい。
  // そこでこの2つだけは、待たずに結果を返すメソッドにしてある。中身は NoteManager に任せる（画面 → Controller → Manager の順は同じ）

  /** G004 ノート：partId の部品が大きくなって下の部品と重なりそうなら、下の部品をずらした部品を返す（保存はしない） */
  adjustNoteParts(parts: readonly NotePart[], partId: string): NotePart[] {
    return this.noteManager.adjustOverlap(new Note({ parts: [...parts] }), partId).parts;
  }

  /** G004 右サイドバーの目次：見出しと枠を上から順に返す */
  tableOfContents(parts: readonly NotePart[]): TocEntry[] {
    return this.noteManager.getTableOfContents(new Note({ parts: [...parts] }));
  }

  /** 保存してあるノートの中身を、画面の下書きの部品に入れ替えたノート（保存はしない。AIまとめで「今のノート」として使う） */
  private async draftNote(studentId: string, itemId: string, parts: readonly NotePart[]): Promise<Note> {
    return new Note({ ...await this.noteManager.getNote(itemId, studentId), parts: [...parts] });
  }

  /**
   * その学生の科目・学習項目・前提項目・ノート・テスト・資料を、Manager から beans のまま読む。
   * 別の端末で作った分も、ログインしたときに画面に出せるようにするため。科目ごと・学習項目ごとに並べて（Promise.all で同時に）読む
   */
  private async loadStudentData(studentId: string): Promise<StudentData> {
    const subjects = await this.subjectManager.getSubjects(studentId);
    const maps = await Promise.all(subjects.map(s => this.itemManager.getRelationMap(s.subjectId)));
    const items = maps.flatMap(m => m.items), prerequisites = maps.flatMap(m => m.prerequisites);
    const [notes, tests, materials] = await Promise.all([
      Promise.all(items.map(i => this.noteManager.getNote(i.itemId, studentId))),
      Promise.all(items.map(i => this.testManager.getTests(i.itemId))).then(l => l.flat()),
      Promise.all(items.map(i => this.materialManager.getMaterials(i.itemId))).then(l => l.flat()),
    ]);
    return { subjects, items, prerequisites, notes, tests, materials };
  }
}

/** 送る文章から SendContent を作る */
const sendContentOf = (text: string) => new SendContent({ text, charCount: text.length });

/** アプリ全体で1つだけ使う Controller */
export const controller = new Controller();
