// TEST-01a・TEST-05a：受験保存の原子性

import "fake-indexeddb/auto";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { openDb } from "../../src/dao/idb";
import { TestDAO } from "../../src/dao/TestDAO";
import { TestManager } from "../../src/managers/TestManager";
import { Test } from "../../src/beans/Test";
import { Question } from "../../src/beans/Question";
import { TestType } from "../../src/enums/TestType";

const testId = "test-1";
const studentId = "student-1";
const questionId = "question-1";

const dao = new TestDAO();

const sync = {
  pushChanges: vi.fn().mockResolvedValue(undefined),
};

const manager = new TestManager(
  dao,
  {
    getWords: vi.fn().mockResolvedValue([]),
  },
  sync
);

beforeEach(async () => {
  sync.pushChanges.mockClear();

  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      "tests",
      "readwrite"
    );

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    tx.objectStore("tests").clear();
  });

  await dao.insert(
    new Test({
      testId,
      studentId,
      itemId: "item-1",
      testType: TestType.MEANING_TO_TERM,

      questions: [
        new Question({
          questionId,
          testId,
          studentId,
          number: 1,
          questionText: "通信プロトコル",
          modelAnswer: "HTTP",
        }),
      ],
    })
  );
});

describe("TEST-01a・05a：受験保存の原子性", () => {
  it("並行保存でも受験番号が重複せず履歴を失わない", async () => {
    const results = await Promise.all([
      manager.submitAnswers(testId, ["HTTP"]),
      manager.submitAnswers(testId, ["HTML"]),
      manager.submitAnswers(testId, ["HTTP"]),
    ]);

    const saved = await dao.findById(testId);

    expect(saved?.attempts).toHaveLength(3);

    expect(
      saved?.attempts.map(a => a.attemptNo)
    ).toEqual([1, 2, 3]);

    expect(
      results.map(a => a.attemptNo)
        .sort((a, b) => a - b)
    ).toEqual([1, 2, 3]);

    expect(
      saved?.attempts.map(
        a => a.answers[0].studentAnswer
      )
    ).toEqual(["HTTP", "HTML", "HTTP"]);

    expect(
      saved?.attempts.map(
        a => a.answers[0].correct
      )
    ).toEqual([true, false, true]);

    expect(saved?.lastTakenAt)
      .toBe(saved?.attempts[2].takenAt);

    expect(sync.pushChanges)
      .toHaveBeenCalledTimes(3);
  });

  it("解説編集と受験保存を並行実行しても両方を保持する", async () => {
    await Promise.all([
      manager.submitAnswers(testId, ["HTTP"]),

      manager.editExplanation(
        testId,
        questionId,
        "HTTPの解説"
      ),
    ]);

    const saved = await dao.findById(testId);

    expect(saved?.attempts).toHaveLength(1);

    expect(saved?.questions[0].explanation)
      .toBe("HTTPの解説");

    expect(saved?.attempts[0].answers[0].correct)
      .toBe(true);
  });

  it("保存途中で中断された場合は受験履歴と日時を保持する", async () => {
    await manager.submitAnswers(
      testId,
      ["HTTP"]
    );

    const before = await dao.findById(testId);

    sync.pushChanges.mockClear();

    const originalPut =
      IDBObjectStore.prototype.put;

    const spy = vi.spyOn(
      IDBObjectStore.prototype,
      "put"
    ).mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const req = originalPut.call(
        this,
        value,
        key
      );

      if (this.name === "tests") {
        req.addEventListener(
          "success",
          () => this.transaction.abort(),
          { once: true }
        );
      }

      return req;
    });

    try {
      await expect(
        manager.submitAnswers(
          testId,
          ["HTML"]
        )
      ).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }

    expect(await dao.findById(testId))
      .toEqual(before);

    expect(sync.pushChanges)
      .not.toHaveBeenCalled();
  });

  it("存在しないテストには受験を保存しない", async () => {
    await expect(
      manager.submitAnswers(
        "missing-test",
        ["HTTP"]
      )
    ).rejects.toThrow(
      "テストが見つかりません"
    );

    expect(
      await dao.findById("missing-test")
    ).toBeNull();

    expect(sync.pushChanges)
      .not.toHaveBeenCalled();
  });
});