// SubjectDAO（DAO／フロントエンド）：科目を端末（IndexedDB）に保存・読み込みする
// 担当：。Neon への同期は SyncManager がする
import { Subject } from "../beans/Subject";
import { now } from "../beans/DateTime";
import { del, get, getAllBy, put, recordDeletion } from "./idb";

export class SubjectDAO {
  /** その学生の科目を、作った順に返す */
  async findByStudent(studentId: string): Promise<Subject[]> {
    const rows = await getAllBy<Subject>("subjects", "studentId", studentId);
    return rows.map(r => new Subject(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /** 科目を追加する */
  async insert(subject: Subject): Promise<void> {
    const t = now();
    await put("subjects", new Subject({ ...subject, createdAt: subject.createdAt || t, updatedAt: t }));
  }
  /** 科目名を変える */
  async updateName(subjectId: string, name: string): Promise<void> {
    const s = await get<Subject>("subjects", subjectId); if (!s) return;
    await put("subjects", { ...s, subjectName: name, updatedAt: now() });
  }
  /** 科目を消す（中の学習項目などは、SubjectManager が LearningItemManager.deleteItem で消す） */
  async delete(subjectId: string): Promise<void> {
    const s = await get<Subject>("subjects", subjectId); if (!s) return;
    await del("subjects", subjectId);
    await recordDeletion("subject", subjectId, s.studentId); // Neon では中の学習項目〜解答もまとめて消える
  }
}