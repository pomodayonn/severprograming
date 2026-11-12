// SubjectManager（Entity Manager／フロントエンド）：科目を管理する
// 担当：（11/11）。変更はその場で端末に保存し、SyncManager でアカウントにも送る
import { Subject } from "../beans/Subject";
import type { SubjectDAO } from "../dao/SubjectDAO";
import { get, put } from "../dao/idb";
import { AppError, checkName, newId, pushQuietly, type ChangePusher } from "./common";
import type { LearningItemManager } from "./LearningItemManager";

/** 画面に出す文を持ったエラー */
export class SubjectError extends AppError {}

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
   * 科目を削除する。中の学習項目ごとに LearningItemManager.deleteItem() を呼ぶので、
   * ノート・テスト・ストレージ（端末の資料）も一緒に消える
   */
  async deleteSubject(subjectId: string): Promise<void> {
    for (const item of await this.itemManager.getItems(subjectId)) await this.itemManager.deleteItem(item.itemId, false);
    await this.subjectDAO.delete(subjectId);
    await this.sync();
  }

  /**
   * 移行用：画面の古い保存場所（localStorage）にある科目のうち、まだ端末のデータベースにないものを、同じIDで入れる。
   * 画面を全部 Manager 経由に置き換えたら使わなくなる
   */
  async importSubjects(studentId: string, subjects: { id: string; name: string }[]): Promise<number> {
    const have = new Set((await this.getSubjects(studentId)).map(s => s.subjectId));
    const add = subjects.filter(s => !have.has(s.id));
    for (const s of add) await this.subjectDAO.insert(new Subject({ subjectId: s.id, studentId, subjectName: s.name.trim().slice(0, 50) || "科目" }));
    if (add.length) await this.sync();
    return add.length;
  }

  /** 移行用：この端末で、この学生の前のデータをもう移したか */
  async isMigrated(studentId: string): Promise<boolean> {
    return !!(await get<boolean>("meta", `migrated:${studentId}`));
  }
  /** 移行用：この端末で、この学生の前のデータを移し終えた印を付ける（2回目からは移さない） */
  async setMigrated(studentId: string): Promise<void> {
    await put("meta", true, `migrated:${studentId}`);
  }

  private sync() { return pushQuietly(this.syncManager); }
}