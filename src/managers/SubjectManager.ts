// SubjectManager（Entity Manager／フロントエンド）：科目を管理する
// 担当s
import { Subject } from "../beans/Subject";
import type { SubjectDAO } from "../dao/SubjectDAO";
import type { ChangePusher } from "./TestManager";
import type { LearningItemManager } from "./LearningItemManager";

/** 画面に出す文を持ったエラー */
export class SubjectError extends Error {}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
/** 名前は前後の空白を取って1〜50文字 */
const checkName = (name: string): string => {
  const n = name.trim();
  if (!n) throw new SubjectError("科目名を入力してください");
  if ([...n].length > 50) throw new SubjectError("科目名は50文字までです");
  return n;
};

export class SubjectManager {
  constructor(
    private readonly subjectDAO: SubjectDAO,
    private readonly itemManager: LearningItemManager,
    private syncManager: ChangePusher | null = null,
  ) {}

  setSyncManager(sync: ChangePusher) { this.syncManager = sync; }

  /** その学生の科目一覧を返す（作った順） */
  async getSubjects(studentId: string): Promise<Subject[]> {
    return this.subjectDAO.findByStudent(studentId);
  }

  /** 科目を作る。同じ名前の科目があれば作らない */
  async createSubject(studentId: string, name: string): Promise<Subject> {
    const n = checkName(name);
    if ((await this.getSubjects(studentId)).some(s => s.subjectName === n)) throw new SubjectError("同じ名前の科目がすでにあります");
    const subject = new Subject({ subjectId: uid(), studentId, subjectName: n });
    await this.subjectDAO.insert(subject); await this.sync();
    return (await this.getSubjects(studentId)).find(s => s.subjectId === subject.subjectId)!;
  }

  /** 科目名を変える */
  async renameSubject(studentId: string, subjectId: string, name: string): Promise<void> {
    const n = checkName(name);
    if ((await this.getSubjects(studentId)).some(s => s.subjectName === n && s.subjectId !== subjectId)) throw new SubjectError("同じ名前の科目がすでにあります");
    await this.subjectDAO.updateName(subjectId, n); await this.sync();
  }

  /**
   * 科目を削除する。中の学習項目ごとに LearningItemManager.deleteItem() を呼ぶので、
   * ノート・テスト・ストレージ（端末の資料）も一緒に消える
   */
  async deleteSubject(subjectId: string): Promise<void> {
    for (const item of await this.itemManager.getItems(subjectId)) await this.itemManager.deleteItem(item.itemId, false);
    await this.subjectDAO.delete(subjectId);
    await this.sync();
  }

  private async sync() { try { await this.syncManager?.pushChanges(); } catch { /* 同期の失敗は保存の失敗にしない（次回送る） */ } }
}