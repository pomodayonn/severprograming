// PrerequisiteDAO（DAO／フロントエンド）：前提項目（「この項目の前提はこれ」）を端末（IndexedDB）に保存・読み込みする
// 担当：
import { Prerequisite } from "../beans/Prerequisite";
import { now } from "../beans/DateTime";
import { del, get, getAll, getAllBy, put, recordDeletion } from "./idb";
import type { LearningItem } from "../beans/LearningItem";

export class PrerequisiteDAO {
  /** その科目の前提項目をすべて返す（関連図を描くのに使う） */
  async findBySubject(subjectId: string): Promise<Prerequisite[]> {
    const items = await getAllBy<LearningItem>("learningItems", "subjectId", subjectId);
    const lists = await Promise.all(items.map(i => getAllBy<Prerequisite>("prerequisites", "itemId", i.itemId)));
    return lists.flat().map(r => new Prerequisite(r));
  }
  /** 前提項目を追加する */
  async insert(p: Prerequisite): Promise<void> {
    await put("prerequisites", new Prerequisite({ ...p, updatedAt: now() }));
  }
  /** 前提項目を外す */
  async delete(itemId: string, prereqItemId: string): Promise<void> {
    const p = await get<Prerequisite>("prerequisites", [itemId, prereqItemId]); if (!p) return;
    await del("prerequisites", [itemId, prereqItemId]);
    await recordDeletion("prerequisite", `${itemId}|${prereqItemId}`, p.studentId);
  }
  /** その学習項目に関係する前提項目（前提にしている・されている）を端末から消す。学習項目を消すときに使う */
  async deleteByItem(itemId: string): Promise<void> {
    const all = await getAll<Prerequisite>("prerequisites");
    for (const p of all.filter(x => x.itemId === itemId || x.prereqItemId === itemId)) await del("prerequisites", [p.itemId, p.prereqItemId]);
    // Neon では学習項目を消すと前提項目も一緒に消える（ON DELETE CASCADE）ので、削除の記録はいらない
  }
}