// Controller（Controller／フロントエンド）：画面のボタン操作を受け取り、担当の Manager に仕事を渡す。
// イベントIDは外部設計書のイベント一覧表のとおり。W2 で画面を1つずつ handleRequest 経由に置き換えていく。
import type { El, Screen, Student, Subject as ScreenSubject } from "../types";
import { neonAuthClient } from "../boundary/NeonAuthClient";
import { AccountManager } from "../managers/AccountManager";
import { AppError } from "../managers/common";
import { SyncManager } from "../managers/SyncManager";
import { SendContentManager } from "../managers/SendContentManager";
import { AiSummaryManager } from "../managers/AiSummaryManager";
import { TestManager } from "../managers/TestManager";
import { SubjectManager } from "../managers/SubjectManager";
import { LearningItemManager } from "../managers/LearningItemManager";
import { NoteManager } from "../managers/NoteManager";
import { SubjectDAO } from "../dao/SubjectDAO";
import { LearningItemDAO } from "../dao/LearningItemDAO";
import { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import { MaterialDAO } from "../dao/MaterialDAO";
import { NoteDAO } from "../dao/NoteDAO";
import { TestDAO } from "../dao/TestDAO";

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
  // ---- Aの分（11/11。G003・G004・ノートの保存から使い始めた） ----
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
        // ---- ログインした直後：端末のデータベース（アカウントから受け取った分）を、画面の形にして返す ----
        // この端末で初めてなら、前の保存場所（local）のデータを先に Manager に移す（1回だけ）
        case "G003:loadSubjects":
          await this.migrateOnce(params.studentId ?? "", JSON.parse(params.local ?? "[]") as ScreenSubject[]);
          return { data: await this.loadScreenSubjects(params.studentId ?? "") };
      }
      // ---- ログアウト（ヘッダーのボタンなので、どの画面からでも） ----
      if (eventId === "logoutButton") { await this.accountManager.logout(); return { next: "G001", student: null }; }
      return { error: `まだ作っていない操作です（${screenId}:${eventId}）` };
    } catch (e) {
      // Manager のエラー（AppError）は文をそのまま画面に出す
      return { error: e instanceof AppError ? e.message : "うまくいきませんでした。時間をおいて試してください" };
    }
  }

  /**
   * 移行中のつなぎ：画面の前の保存場所（localStorage）にある科目・学習項目・前提項目・保存済みのノートを、
   * この端末・この学生で1回だけ Manager に移す。2回目からは移さない
   * （移し直すと、別の端末で消したものが戻ってきてしまうため）
   */
  private async migrateOnce(studentId: string, local: ScreenSubject[]): Promise<void> {
    if (!studentId || await this.subjectManager.isMigrated(studentId)) return;
    await this.subjectManager.importSubjects(studentId, local.map(s => ({ id: s.id, name: s.name })));
    for (const s of local) {
      await this.itemManager.importItems(studentId, s.id, s.items.map(i => ({ id: i.id, name: i.name, prereqs: i.prereqs })));
      for (const i of s.items) await this.noteManager.importNote(studentId, i.id, i.note.els, i.note.savedAt);
    }
    await this.subjectManager.setMigrated(studentId);
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