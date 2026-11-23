// 単体テスト：TestManager.deleteTests（テスト一覧の「削除」）
// 本物の端末のデータベースの代わりに、メモリの中だけの TestDAO を使って確かめる
import { describe, expect, it } from "vitest";
import { TestManager } from "../../src/managers/TestManager";
import type { TestDAO } from "../../src/dao/TestDAO";
import { Test } from "../../src/beans/Test";

/** findById と delete だけを持つ、メモリの中の TestDAO */
function fakeDao(ids: string[]) {
  const store = new Map(ids.map(id => [id, new Test({ testId: id })]));
  const dao = {
    findById: async (id: string) => store.get(id) ?? null,
    delete: async (id: string) => { store.delete(id); },
  };
  return { store, manager: new TestManager(dao as unknown as TestDAO, null as never, null) };
}
const errorOf = async (f: () => Promise<unknown>) => { try { await f(); return ""; } catch (e) { return (e as Error).message; } };

describe("deleteTests：テストを消す", () => {
  it("1つ消せる", async () => {
    const { store, manager } = fakeDao(["t1", "t2"]);
    await manager.deleteTests(["t1"]);
    expect([...store.keys()]).toEqual(["t2"]);
  });
  it("まとめて消せる", async () => {
    const { store, manager } = fakeDao(["t1", "t2", "t3"]);
    await manager.deleteTests(["t1", "t3"]);
    expect([...store.keys()]).toEqual(["t2"]);
  });
  it("何も選んでいなければエラー", async () => {
    const { manager } = fakeDao(["t1"]);
    expect(await errorOf(() => manager.deleteTests([]))).toBe("消すテストを選んでください");
  });
  it("ないテストがまざっていたら、どれも消さない", async () => {
    const { store, manager } = fakeDao(["t1", "t2"]);
    expect(await errorOf(() => manager.deleteTests(["t1", "nai"]))).toBe("テストが見つかりません");
    expect(store.size).toBe(2);
  });
});
