// MaterialDAO（DAO／フロントエンド）：資料と文字起こしを端末（IndexedDB）に保存する。サーバーには送らない
// 
//
// 【このファイルで何が起きているか】
// 資料（情報は materials、ファイルの中身は materialContents）を、端末の IndexedDB（dao/idb.ts）に保存したり読み出したりする係（DAO）です。
// DAO は「しまう・取り出す」だけをして、名前が正しいかなどの確認は Manager（MaterialManager（福山さんが作る））がする。
// 流れ：画面 → Controller → MaterialManager（福山さんが作る） → ここ → IndexedDB
// 資料は大きいので Neon には送らない（この端末だけ）
import { Material } from "../beans/Material";
import { now } from "../beans/DateTime";
import { get,getAllBy,put,putMaterialWithContent,deleteMaterialWithContent,} from "./idb";

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
  /** 資料情報とファイル本体を同時に保存する */
  async insert(
    material: Material,
    content: Blob | string
  ): Promise<void> {
    const size = typeof content === "string"
      ? new Blob([content]).size
      : content.size;

    await putMaterialWithContent(
      new Material({
        ...material,
        fileSize: material.fileSize || size,
        addedAt: material.addedAt || now(),
      }),
      content
    );
  }
  /** 文字起こしの文章を書き換える（G006 の「確定」） */
  async updateText(materialId: string, text: string): Promise<void> {
    const m = await get<Material>("materials", materialId); if (!m) return;
    await put("materialContents", text, materialId);
    await put("materials", { ...m, fileSize: new Blob([text]).size });
  }
  /** 資料情報とファイル本体を同時に削除する */
  async delete(materialId: string): Promise<void> {
    await deleteMaterialWithContent(materialId);
  }
  /** 学習項目を消したときに、ストレージを中の資料ごと消す */
  async deleteStorage(itemId: string): Promise<void> {
    for (const m of await getAllBy<Material>("materials", "itemId", itemId)) await this.delete(m.materialId);
  }
}