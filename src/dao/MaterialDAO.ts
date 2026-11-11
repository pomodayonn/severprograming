// MaterialDAO（DAO／フロントエンド）：資料と文字起こしを端末（IndexedDB）に保存する。サーバーには送らない
// 
import { Material } from "../beans/Material";
import { now } from "../beans/DateTime";
import { del, get, getAllBy, put } from "./idb";

export class MaterialDAO {
  /** その学習項目（ストレージ）の資料を、追加した順に返す */
  async findByItem(itemId: string): Promise<Material[]> {
    const rows = await getAllBy<Material>("materials", "itemId", itemId);
    return rows.map(r => new Material(r)).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }
  /** 資料を1つ返す（なければ null） */
  async findById(materialId: string): Promise<Material | null> {
    const r = await get<Material>("materials", materialId); return r ? new Material(r) : null;
  }
  /** 資料の中身（画像・PDF は Blob、テキスト・文字起こしは文字列）を返す */
  async findContent(materialId: string): Promise<Blob | string | null> {
    return (await get<Blob | string>("materialContents", materialId)) ?? null;
  }
  /** 資料とファイルの中身を保存する */
  async insert(material: Material, content: Blob | string): Promise<void> {
    const size = typeof content === "string" ? new Blob([content]).size : content.size;
    await put("materials", new Material({ ...material, fileSize: material.fileSize || size, addedAt: material.addedAt || now() }));
    await put("materialContents", content, material.materialId);
  }
  /** 文字起こしの文章を書き換える（G006 の「確定」） */
  async updateText(materialId: string, text: string): Promise<void> {
    const m = await get<Material>("materials", materialId); if (!m) return;
    await put("materialContents", text, materialId);
    await put("materials", { ...m, fileSize: new Blob([text]).size });
  }
  /** 資料を消す */
  async delete(materialId: string): Promise<void> {
    await del("materials", materialId); await del("materialContents", materialId);
  }
  /** 学習項目を作ったときに、空のストレージを作る。資料は学習項目IDでまとまるので、入れ物を作る必要はない */
  async createStorage(_itemId: string): Promise<void> { /* 何もしない（クラス設計に合わせて用意） */ }
  /** 学習項目を消したときに、ストレージを中の資料ごと消す */
  async deleteStorage(itemId: string): Promise<void> {
    for (const m of await getAllBy<Material>("materials", "itemId", itemId)) await this.delete(m.materialId);
  }
}