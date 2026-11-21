// Controller（Controller／フロントエンド）：画面のボタン操作を受け取り、担当の Manager に仕事を渡す。
// イベントIDは外部設計書のイベント一覧表のとおり。W2 で画面を1つずつ handleRequest 経由に置き換えていく。
//
// 【このファイルで何が起きているか】
// 画面とプログラムの中身をつなぐ「受付」です（Controller）。どの画面のボタンも、まずここに来る。
// 流れ（例：科目の追加）
//   画面（SubjectList.tsx）が controller.handleRequest("G003", "addSubject", { name: "数学" }) を呼ぶ
//   → 下の switch で "G003:addSubject" を見つける
//   → 担当の SubjectManager.createSubject に仕事を渡す
//   → 結果を { data } で、エラーなら { error: "画面に出す文" } で画面に返す
// 画面は Manager や DAO を直接さわらず、必ずここを通る（設計書の「画面 → Controller → Manager → DAO」）。。
import type { El, FrameType, MaterialMeta as ScreenMaterial, Screen, Student, Subject as ScreenSubject, Test as ScreenTest, TestKind } from "../types";
import type { Proposal } from "../services/ai";
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
import { MaterialManager } from "../managers/MaterialManager";
import type { ProgressListener } from "../interfaces/ProgressListener";
import { SubjectDAO } from "../dao/SubjectDAO";
import { LearningItemDAO } from "../dao/LearningItemDAO";
import { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import { MaterialDAO } from "../dao/MaterialDAO";
import { NoteDAO } from "../dao/NoteDAO";
import { TestDAO } from "../dao/TestDAO";
import { SendContent } from "../beans/SendContent";
import { Suggestion } from "../beans/Suggestion";
import { Note } from "../beans/Note";

/** handleRequest の結果。next があれば画面を移る。error は画面に出す文 */
/** data は Manager が返したもの（作った科目など）。画面はこれを使って表示を変える */
export interface ControllerResult { next?: Screen; student?: Student | null; error?: string; data?: unknown }
/**
 * 文字列では渡せないもの（handleRequest の4つ目の引数）。資料の追加と文字起こしで使う
 * ・file    ：追加するファイル（G004:uploadMaterial）
 * ・listener：文字起こしの進み具合を受け取る係（G004:transcribe。Java の ActionListener と同じ考え方）
 */
export interface ControllerExtra { file?: File; listener?: ProgressListener }

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
  readonly materialManager = new MaterialManager(this.materialDAO); // 11/21（福山）：資料と文字起こし

  constructor() {
    this.aiSummaryManager.setNoteManager(this.noteManager); // 承認したAIの提案を NoteManager でノートに反映する
    // 11/17：オフラインから戻ったら、その間に保存した分をアカウント（Neon）に送る
    if (typeof window !== "undefined") window.addEventListener("online", () => { void this.syncManager.pushChanges().catch(() => {}); });
  }

  /**
   * どの画面のどのボタンかを見て、担当の Manager を呼ぶ。
   * 例：G001 の login → AccountManager.login()
   */
  async handleRequest(screenId: Screen, eventId: string, params: Record<string, string> = {}, extra: ControllerExtra = {}): Promise<ControllerResult> {
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
        // ---- G004 学習画面（資料）・G005 資料表示・G006 文字起こし修正（11/21 福山：MaterialManager） ----
        case "G004:uploadMaterial": { // 「＋ 資料の追加」：ファイルは extra.file。保存した資料を返す（文字起こしは続けて G004:transcribe）
          if (!extra.file) return { error: "ファイルを選んでください" };
          return { data: this.materialManager.toScreenMaterial(await this.materialManager.upload(params.itemId ?? "", extra.file)) };
        }
        case "G004:transcribe": { // 文字起こし：進み具合は extra.listener に知らせる。できた .txt と、読み取れなかったページを返す
          const r = await this.materialManager.transcribe(params.materialId ?? "", extra.listener ?? { onProgress: () => {} });
          return { data: { transcript: this.materialManager.toScreenMaterial(r.transcript), failedPages: r.failedPages } };
        }
        case "G004:getContent": // 資料の中身（学習画面の「資料と並べる」・資料表示・文字起こし修正・AIに送る内容で使う）
        case "G005:getContent":
        case "G006:getContent":
        case "G007:getContent":
          return { data: await this.materialManager.getContent(params.materialId ?? "") };
        case "G005:deleteMaterial": // 資料の削除。withTranscript が "true" なら、この資料から作った文字起こしも消す
          await this.materialManager.delete(params.materialId ?? "", params.withTranscript === "true");
          return {};
        case "G006:correctTranscript": // 文字起こし修正の「確定」
          await this.materialManager.correctTranscript(params.materialId ?? "", params.text ?? "");
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
        // ---- G007 送信内容・提案確認（AIまとめ） ----
        case "G007:summarize": { // 送信：AIに送って提案をもらう。els は今のノート（下書き）、frameTypes はカンマ区切り
          const note = await this.screenNote(params.studentId ?? "", params.itemId ?? "", params.els);
          const text = params.text ?? "";
          const list = await this.aiSummaryManager.summarize(new SendContent({ text, charCount: text.length }), note, (params.frameTypes ?? "").split(",").filter(Boolean) as FrameType[]);
          return { data: list.map((s, i) => toProposal(s, i)) };
        }
        case "G007:approve": { // 承認：選んだ提案を入れたノートを返す（保存はしない。学習画面の「保存」で保存する）
          const note = await this.screenNote(params.studentId ?? "", params.itemId ?? "", params.els);
          const picked = (JSON.parse(params.proposals ?? "[]") as Proposal[]).map(fromProposal);
          return { data: this.noteManager.toElements(this.aiSummaryManager.mergeApproved(note, picked)) };
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
        case "G003:loadSubjects": {
          const sid = params.studentId ?? "";
          const subjects = await this.loadScreenSubjects(sid);
          return { data: { subjects, tests: await this.loadScreenTests(subjects), materials: await this.loadScreenMaterials(subjects) } };
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

  /** 移行中のつなぎ：画面の部品（JSON）から、その学習項目のノート（beans の Note）を作る。保存はしない */
  private async screenNote(studentId: string, itemId: string, els?: string): Promise<Note> {
    const base = await this.noteManager.getNote(itemId, studentId);
    return new Note({ ...base, parts: this.noteManager.toParts(JSON.parse(els ?? "[]") as El[], base.noteId, studentId) });
  }

  /** 移行中のつなぎ：画面に出している学習項目の資料（ストレージ）を、画面の形にして返す */
  private async loadScreenMaterials(subjects: ScreenSubject[]): Promise<ScreenMaterial[]> {
    const out: ScreenMaterial[] = [];
    for (const s of subjects) for (const i of s.items) for (const m of await this.materialManager.getMaterials(i.id)) out.push(this.materialManager.toScreenMaterial(m));
    return out;
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

/** 提案（beans の Suggestion）を画面の形（Proposal）にする。単語枠は「用語：意味」の行を words に分ける */
function toProposal(s: Suggestion, i: number): Proposal {
  const words = s.frameType === "word" ? s.content.split("\n").filter(l => l.trim()).map(l => { const [a, ...b] = l.split(/：|:/); return { term: a.trim(), meaning: b.join("：").trim() }; }) : undefined;
  return { id: `p${i}`, ft: s.frameType as FrameType, targetId: s.targetPartId ?? undefined, text: s.frameType === "word" ? "" : s.content, words };
}
/** 画面の提案（Proposal）を beans の Suggestion に戻す（画面で選んだものなので approved = true） */
function fromProposal(p: Proposal): Suggestion {
  const content = p.ft === "word" ? (p.words ?? []).map(w => `${w.term}：${w.meaning}`).join("\n") : p.text;
  return new Suggestion({ targetPartId: p.targetId ?? null, frameType: p.ft, content, approved: true });
}

/** アプリ全体で1つだけ使う Controller */
export const controller = new Controller();