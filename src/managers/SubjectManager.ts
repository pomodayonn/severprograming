// SubjectManager（Entity Manager／フロントエンド）：科目を管理する
// 担当：（11/11）。変更はその場で端末に保存し、SyncManager でアカウントにも送る
//
// 【このファイルで何が起きているか】
// 科目の「作る・名前を変える・消す」の確認係です（Manager）。
// 例：「＋ 科目の追加」→ Controller（G003:addSubject）→ createSubject
//   1. 名前を確認（空・51文字以上はだめ、同じ名前の科目もだめ）
//   2. SubjectDAO で端末に保存
//   3. sync() で Neon に送る（pushQuietly）
import { Subject } from "../beans/Subject";
import type { SubjectDAO } from "../dao/SubjectDAO";
import { AppError, checkName, newId, pushQuietly, type ChangePusher } from "./common";
import type { LearningItemManager } from "./LearningItemManager";

/** 画面に出す文を持ったエラー */
export class SubjectError extends AppError {}

export class SubjectManager {
  constructor(
    private readonly subjectDAO: SubjectDAO,
    private readonly itemManager: LearningItemManager,
    private readonly syncManager: ChangePusher | null = null,
  ) {}

  /** その学生の科目一覧を返す（作った順） */
  async getSubjects(studentId: string): Promise<Subject[]> {
    return this.subjectDAO.findByStudent(studentId);
  }

  /** 科目を作る。同じ名前の科目があれば作らない */
  async createSubject(studentId: string, name: string): Promise<Subject> {
    const n = checkName(name, "科目名", SubjectError);
    if ((await this.getSubjects(studentId)).some(s => s.subjectName === n)) throw new SubjectError("同じ名前の科目がすでにあります");
    const subject = new Subject({ subjectId: newId(), studentId, subjectName: n });
    await this.subjectDAO.insert(subject); await this.sync();
    return (await this.getSubjects(studentId)).find(s => s.subjectId === subject.subjectId)!;
  }

  /** 科目名を変える */
  async renameSubject(studentId: string, subjectId: string, name: string): Promise<void> {
    const n = checkName(name, "科目名", SubjectError);
    if ((await this.getSubjects(studentId)).some(s => s.subjectName === n && s.subjectId !== subjectId)) throw new SubjectError("同じ名前の科目がすでにあります");
    await this.subjectDAO.updateName(subjectId, n); await this.sync();
  }

  /**
   * 科目を削除する。DAOで全学習項目・ノート・テスト・資料・削除ログを
   * まとめてコミットし、成功後に一度だけ同期する。
   */
  async deleteSubject(subjectId: string): Promise<void> {
    await this.subjectDAO.delete(subjectId);
    await this.sync();
  }

  private sync() { return pushQuietly(this.syncManager); }
}