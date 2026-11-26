// 単体テスト：SyncManager.sendAll
// ログアウト時の未同期データ消失を防止するための回帰テスト。
// 実際の Neon や IndexedDB は使用しない。

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { SyncManager } from "../../src/managers/SyncManager";
import { AccountManager } from "../../src/managers/AccountManager";
import { Student } from "../../src/beans/Student";
import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";
import { get, clearStudentData } from "../../src/dao/idb";

// IndexedDB の読み取りと削除をテスト用の処理に置き換える。
vi.mock("../../src/dao/idb", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../src/dao/idb")>();

  return {
    ...original,
    get: vi.fn(),
    clearStudentData: vi.fn(),
  };
});

const student = new Student({
  studentId: "student-1",
});

// テスト用の認証クライアントと同期管理クラスを作る。
function setup(enabled = true) {
  const auth = {
    neon: enabled,
    getSession: vi.fn<() => Promise<Student | null>>()
      .mockResolvedValue(student),
    signOut: vi.fn().mockResolvedValue(undefined),
  };

  const authClient = auth as unknown as NeonAuthClient;

  const sync = new SyncManager(
    authClient,
    "https://example.invalid"
  );

  // 実際のネットワーク通信を行わない。
  const push = vi.spyOn(sync, "pushChanges")
    .mockResolvedValue(undefined);

  vi.spyOn(sync, "forgetPull")
    .mockResolvedValue(undefined);

  const account = new AccountManager(authClient, sync);

  return { auth, sync, push, account };
}

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(get).mockResolvedValue([]);

  vi.mocked(clearStudentData).mockReset();
  vi.mocked(clearStudentData).mockResolvedValue(undefined);
});

describe("sendAll：同期結果の確認", () => {

  it("同期が無効なら false を返す", async () => {
    const { sync, push } = setup(false);

    expect(await sync.sendAll()).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("ログインしていなければ false を返す", async () => {
    const { auth, sync, push } = setup();
    auth.getSession.mockResolvedValue(null);

    expect(await sync.sendAll()).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("同期に成功し競合がなければ true を返す", async () => {
    const { sync } = setup();

    expect(await sync.sendAll()).toBe(true);

    expect(get).toHaveBeenCalledWith(
      "meta",
      "noteConflicts:student-1"
    );
  });

  it("通信に失敗したら false を返す", async () => {
    const { sync, push } = setup();

    push.mockRejectedValueOnce(
      new Error("通信エラー")
    );

    expect(await sync.sendAll()).toBe(false);
  });

  it("同期後に競合が残っていれば false を返す", async () => {
    const { sync } = setup();

    vi.mocked(get).mockResolvedValue(["note-1"]);

    expect(await sync.sendAll()).toBe(false);
  });

  it("競合情報の取得に失敗したら false を返す", async () => {
    const { sync } = setup();

    vi.mocked(get).mockRejectedValueOnce(
      new Error("IndexedDBエラー")
    );

    expect(await sync.sendAll()).toBe(false);
  });

  it("同期中にログイン状態が失われたら false を返す", async () => {
    const { auth, sync } = setup();

    auth.getSession
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(null);

    expect(await sync.sendAll()).toBe(false);
  });

  it("同期中に別アカウントになったら false を返す", async () => {
    const { auth, sync } = setup();

    auth.getSession
      .mockResolvedValueOnce(student)
      .mockResolvedValueOnce(
        new Student({ studentId: "student-2" })
      );

    expect(await sync.sendAll()).toBe(false);
  });

});

describe("ログアウト：端末データの保護", () => {

  it("競合がある場合は削除もログアウトも行わない", async () => {
    const { account, auth } = setup();

    vi.mocked(get).mockResolvedValue(["note-1"]);

    expect(await account.logout(true, false))
      .toBe("unsent");

    expect(clearStudentData).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("正常に同期できた場合は削除してログアウトする", async () => {
    const { account, auth } = setup();

    expect(await account.logout(true, false))
      .toBe("done");

    expect(clearStudentData)
      .toHaveBeenCalledWith("student-1");

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("利用者が強制削除を選んだ場合は削除できる", async () => {
    const { account, auth } = setup();

    vi.mocked(get).mockResolvedValue(["note-1"]);

    expect(await account.logout(true, true))
      .toBe("done");

    expect(clearStudentData)
      .toHaveBeenCalledWith("student-1");

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("データを残すログアウトでは端末データを削除しない", async () => {
    const { account, auth, push } = setup();

    expect(await account.logout(false))
      .toBe("done");

    expect(clearStudentData).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

});
