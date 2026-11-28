// LearningItemManager（Entity Manager／フロントエンド）：学習項目と前提項目（関連図）を管理する
// 担当：（11/11）。変更はその場で端末に保存し、SyncManager でアカウントにも送る
// 【このファイルで何が起きているか】
// 学習項目と前提項目（関連図）の確認係です（Manager）。
// ・createItem：学習項目を作るとき、空のノート・資料置き場・テスト置き場も一緒に作る
// ・deleteItem：消すときは、ノート・テスト・資料・前提の関係もまとめて消す（削除の連鎖）
// ・setPrerequisites：前提項目（つながり）を設定する。「前に学ぶ」「次に学ぶ」の両方を決められる（11/26）。輪になる設定は hasCycle で止める
// どれも最後に sync() で Neon に送る
import { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import type { LearningItemDAO } from "../dao/LearningItemDAO";
import type { PrerequisiteDAO } from "../dao/PrerequisiteDAO";
import type { NoteDAO } from "../dao/NoteDAO";
import type { TestDAO } from "../dao/TestDAO";
import type { MaterialDAO } from "../dao/MaterialDAO";
import { hasCycle, planLinks } from "../lib/logic";
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
    private readonly syncManager: ChangePusher | null = null,
  ) {}

  /** その科目の学習項目一覧を返す（作った順） */
  async getItems(subjectId: string): Promise<LearningItem[]> {
    return this.itemDAO.findBySubject(subjectId);
  }

  /** 学習項目を作り、同時に空のノートを1枚作る（資料とテストは学習項目IDでまとまるので、入れ物を作る必要はない） */
  async createItem(studentId: string, subjectId: string, name: string): Promise<LearningItem> {
    const n = checkName(name, "学習項目名", ItemError);
    if ((await this.getItems(subjectId)).some(i => i.itemName === n)) throw new ItemError("同じ名前の学習項目がすでにあります");
    const item = new LearningItem({ itemId: newId(), studentId, subjectId, itemName: n });
    await this.itemDAO.insert(item);
    await this.noteDAO.insertEmpty(item.itemId, studentId);
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
    // DAOで関連行・資料本体・削除ログをまとめてコミットする。
    await this.itemDAO.delete(itemId);
    if (sync) await this.sync();
  }

  /**
   * その学習項目の前提をまとめて設定し直す（G004 の前提項目のチェックボックスで「決定」したとき）。
   * 前提にできるのは同じ科目の学習項目だけ。自分自身と、一周する関係はだめ
   */
  /**
   * つながりを設定する（11/26：「次に学ぶ項目」もまとめて決められるようにした）。
   * prereqItemIds：この項目の前に学ぶ項目。nextItemIds：この項目のあとに学ぶ項目（渡さなければ今のまま）
   */
  async setPrerequisites(
    itemId: string,
    prereqItemIds: string[],
    nextItemIds?: string[]
  ): Promise<void> {
    await this.prerequisiteDAO.editLinks(
      (items, links) => {
        const item = items.find(
          i => i.itemId === itemId
        );

        if (!item?.studentId) {
          throw new ItemError(
            "学習項目が見つかりません"
          );
        }

        const sameSubject = new Set(
          items
            .filter(i =>
              i.subjectId === item.subjectId &&
              i.studentId === item.studentId
            )
            .map(i => i.itemId)
        );

        for (const id of [
          ...prereqItemIds,
          ...(nextItemIds ?? []),
        ]) {
          if (id === itemId) {
            throw new ItemError(
              "自分自身とはつなげません"
            );
          }

          if (!sameSubject.has(id)) {
            throw new ItemError(
              "つなげられるのは同じ科目の学習項目だけです"
            );
          }
        }

        if (
          nextItemIds?.some(
            id => prereqItemIds.includes(id)
          )
        ) {
          throw new ItemError(
            "同じ項目を「前に学ぶ」と「次に学ぶ」の両方にはできません"
          );
        }

        const list = links.filter(l =>
          sameSubject.has(l.itemId) ||
          sameSubject.has(l.prereqItemId)
        );

        // 所有者や所属科目が不正な既存関係は
        // 勝手に変更せず、保存を中止する。
        if (list.some(l =>
          l.studentId !== item.studentId ||
          !sameSubject.has(l.itemId) ||
          !sameSubject.has(l.prereqItemId)
        )) {
          throw new ItemError(
            "前提関係の所有者または所属科目に不整合があります"
          );
        }

        const plan = planLinks(
          list,
          itemId,
          prereqItemIds,
          nextItemIds
        );

        if (hasCycle(plan.result)) {
          throw new ItemError(
            "前提項目が輪になるため設定できません（A → B → A のように一周するつなぎ方はできません）"
          );
        }

        return {
          studentId: item.studentId,
          add: plan.add,
          remove: plan.remove,
        };
      }
    );

    await this.sync();
  }

  /** 関連図を描くための、学習項目と前提関係の一覧を返す */
  async getRelationMap(subjectId: string): Promise<RelationMap> {
    const [items, prerequisites] = await Promise.all([this.getItems(subjectId), this.prerequisiteDAO.findBySubject(subjectId)]);
    return { items, prerequisites };
  }

  private sync() { return pushQuietly(this.syncManager); }
}