// LearningItemDAO（DAO／フロントエンド）：学習項目を端末（IndexedDB）に保存・読み込みする
// 担当：）
import { LearningItem } from "../beans/LearningItem";
import { now } from "../beans/DateTime";
import { del, get, getAllBy, put, recordDeletion } from "./idb";

export class LearningItemDAO {
  /** その科目の学習項目を、作った順に返す */
  async findBySubject(subjectId: string): Promise<LearningItem[]> {
    const rows = await getAllBy<LearningItem>("learningItems", "subjectId", subjectId);
    return rows.map(r => new LearningItem(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** 学習項目を1つ返す（なければ null） */
  async findById(itemId: string): Promise<LearningItem | null> {
    const r = await get<LearningItem>("learningItems", itemId); return r ? new LearningItem(r) : null;
  }
  /** 学習項目を追加する */
  async insert(item: LearningItem): Promise<void> {
    const t = now();
    await put("learningItems", new LearningItem({ ...item, createdAt: item.createdAt || t, updatedAt: t }));
  }
  /** 学習項目名を変える */
  async updateName(itemId: string, name: string): Promise<void> {
    const i = await get<LearningItem>("learningItems", itemId); if (!i) return;
    await put("learningItems", { ...i, itemName: name, updatedAt: now() });
  }
  /** 学習項目を消す（ノート・テスト・資料は LearningItemManager.deleteItem が消す） */
  async delete(itemId: string): Promise<void> {
    const i = await get<LearningItem>("learningItems", itemId); if (!i) return;
    await del("learningItems", itemId);
    await recordDeletion("learning_item", itemId, i.studentId);
  }
}