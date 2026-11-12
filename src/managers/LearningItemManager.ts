// LearningItemManager（Entity Manager／フロントエンド）：学習項目と前提項目（関連図）を管理する
// 担当：（11/11）。変更はその場で端末に保存し、SyncManager でアカウントにも送る
import { LearningItem } from "../beans/LearningItem";
import { Prerequisite } from "../beans/Prerequisite";
import type { LearningItemDAO } from "../dao/LearningItemDAO";
import type { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import type { NoteDAO } from "../dao/NoteDAO";
import type { TestDAO } from "../dao/TestDAO";
import type { MaterialDAO } from "../dao/MaterialDAO";
import { AppError, checkName, newId, pushQuietly, type ChangePusher } from "./common";

/** 画面に出す文を持ったエラー */
export class ItemError extends AppError {}

/** 関連図を描くためのデータ */
export interface RelationMap { items: LearningItem[]; prerequisites: Prerequisite[] }

export class LearningItemManager {
  constructor(
    private readonly itemDAO: LearningItemDAO,
    private readonly prerequisiteDAO: PrerequisiteDAO,
    private readonly noteDAO: NoteDAO,
    private readonly testDAO: TestDAO,
    private readonly materialDAO: MaterialDAO,
    private syncManager: ChangePusher | null = null,
  ) {}

  setSyncManager(sync: ChangePusher) { this.syncManager = sync; }

  /** その科目の学習項目一覧を返す（作った順） */
  async getItems(subjectId: string): Promise<LearningItem[]> {
    return this.itemDAO.findBySubject(subjectId);
  }

  /** 学習項目を作り、同時に空のノート1枚・空のストレージ・空のテストフォルダを作る */
  async createItem(studentId: string, subjectId: string, name: string): Promise<LearningItem> {
    const n = checkName(name, "学習項目名", ItemError);
    if ((await this.getItems(subjectId)).some(i => i.itemName === n)) throw new ItemError("同じ名前の学習項目がすでにあります");
    const item = new LearningItem({ itemId: newId(), studentId, subjectId, itemName: n });
    await this.itemDAO.insert(item);
    await this.noteDAO.insertEmpty(item.itemId, studentId);
    await this.materialDAO.createStorage(item.itemId);
    await this.testDAO.createTestFolder(item.itemId);
    await this.sync();
    return (await this.itemDAO.findById(item.itemId))!;
  }

  /** 学習項目の名前を変える */
  async renameItem(itemId: string, name: string): Promise<void> {
    const n = checkName(name, "学習項目名", ItemError);
    const item = await this.itemDAO.findById(itemId); if (!item) throw new ItemError("学習項目が見つかりません");
    if ((await this.getItems(item.subjectId)).some(i => i.itemName === n && i.itemId !== itemId)) throw new ItemError("同じ名前の学習項目がすでにあります");
    await this.itemDAO.updateName(itemId, n); await this.sync();
  }

  /**
   * 学習項目を削除し、ほかの項目の前提からも外す。ノート・テストフォルダ（中のテスト）・ストレージ（中の資料と文字起こし）も一緒に消す。
   * sync は SubjectManager から科目ごと消すときに false（最後に1回だけ送る）
   */
  async deleteItem(itemId: string, sync = true): Promise<void> {
    await this.prerequisiteDAO.deleteByItem(itemId);
    await this.noteDAO.deleteByItem(itemId);
    await this.testDAO.deleteTestFolder(itemId);
    await this.materialDAO.deleteStorage(itemId);
    await this.itemDAO.delete(itemId);
    if (sync) await this.sync();
  }

  /** 前提項目を設定する（「itemId の前提は prereqItemId」）。同じ科目の中だけ、自分自身と一周する関係はだめ */
  async setPrerequisite(itemId: string, prereqItemId: string): Promise<void> {
    if (itemId === prereqItemId) throw new ItemError("自分自身は前提にできません");
    const [item, pre] = await Promise.all([this.itemDAO.findById(itemId), this.itemDAO.findById(prereqItemId)]);
    if (!item || !pre) throw new ItemError("学習項目が見つかりません");
    if (item.subjectId !== pre.subjectId) throw new ItemError("前提にできるのは同じ科目の学習項目だけです");
    const list = await this.prerequisiteDAO.findBySubject(item.subjectId);
    if (list.some(p => p.itemId === itemId && p.prereqItemId === prereqItemId)) return; // もう設定してある
    if (this.wouldCycle(list, itemId, prereqItemId)) throw new ItemError("前提項目が輪になるため設定できません");
    await this.prerequisiteDAO.insert(new Prerequisite({ studentId: item.studentId, itemId, prereqItemId }));
    await this.sync();
  }

  /** 前提項目を外す */
  async removePrerequisite(itemId: string, prereqItemId: string): Promise<void> {
    await this.prerequisiteDAO.delete(itemId, prereqItemId); await this.sync();
  }

  /** その学習項目の前提をまとめて設定し直す（G004 の前提項目のチェックボックスで「決定」したとき） */
  async setPrerequisites(itemId: string, prereqItemIds: string[]): Promise<void> {
    const item = await this.itemDAO.findById(itemId); if (!item) throw new ItemError("学習項目が見つかりません");
    const list = await this.prerequisiteDAO.findBySubject(item.subjectId);
    const now = list.filter(p => p.itemId === itemId).map(p => p.prereqItemId);
    const others = list.filter(p => p.itemId !== itemId);
    // 先に全部の組み合わせで輪にならないかを確認する（途中まで保存されないように）
    for (const pre of prereqItemIds) {
      if (pre === itemId) throw new ItemError("自分自身は前提にできません");
      if (this.wouldCycle(others, itemId, pre)) throw new ItemError("前提項目が輪になるため設定できません");
    }
    for (const pre of now.filter(p => !prereqItemIds.includes(p))) await this.prerequisiteDAO.delete(itemId, pre);
    for (const pre of prereqItemIds.filter(p => !now.includes(p))) await this.prerequisiteDAO.insert(new Prerequisite({ studentId: item.studentId, itemId, prereqItemId: pre }));
    await this.sync();
  }

  /** 関連図を描くための、学習項目と前提関係の一覧を返す */
  async getRelationMap(subjectId: string): Promise<RelationMap> {
    const [items, prerequisites] = await Promise.all([this.getItems(subjectId), this.prerequisiteDAO.findBySubject(subjectId)]);
    return { items, prerequisites };
  }

  /**
   * 「AはBの前提、BはAの前提」のように関係が一周しないか確認する。
   * itemId の前提に pre を足したとき、pre の前提をたどって itemId に着けば一周する
   */
  private wouldCycle(list: Prerequisite[], itemId: string, pre: string): boolean {
    const seen = new Set<string>();
    const go = (id: string): boolean => {
      if (id === itemId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return list.filter(p => p.itemId === id).some(p => go(p.prereqItemId));
    };
    return go(pre);
  }

  /**
   * 移行用：画面の古い保存場所（localStorage）にある学習項目と前提項目のうち、まだ端末のデータベースにないものを、同じIDで入れる。
   * 画面を全部 Manager 経由に置き換えたら使わなくなる
   */
  async importItems(studentId: string, subjectId: string, items: { id: string; name: string; prereqs: string[] }[]): Promise<number> {
    const have = new Set((await this.getItems(subjectId)).map(i => i.itemId));
    const add = items.filter(i => !have.has(i.id));
    for (const i of add) {
      await this.itemDAO.insert(new LearningItem({ itemId: i.id, studentId, subjectId, itemName: i.name.trim().slice(0, 50) || "学習項目" }));
      if (!(await this.noteDAO.findByItem(i.id))) await this.noteDAO.insertEmpty(i.id, studentId);
    }
    // 前提項目：同じ科目の中にある項目どうしで、まだ入っていない組み合わせだけ入れる
    const ids = new Set(items.map(i => i.id));
    const list = await this.prerequisiteDAO.findBySubject(subjectId);
    let added = add.length;
    for (const i of items) for (const pre of i.prereqs) {
      if (pre === i.id || !ids.has(pre) || list.some(p => p.itemId === i.id && p.prereqItemId === pre)) continue;
      await this.prerequisiteDAO.insert(new Prerequisite({ studentId, itemId: i.id, prereqItemId: pre })); added++;
    }
    if (added) await this.sync();
    return added;
  }

  private sync() { return pushQuietly(this.syncManager); }
}