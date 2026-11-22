// 単体テスト：AccountManager.checkPassword（パスワードの条件：8〜16文字で、英字と数字の両方を含む）
// 外部設計書 G002・テスト仕様書の「パスワードが短い・長い・英字だけ」と同じ条件
import { describe, expect, it } from "vitest";
import { AccountManager } from "../../src/managers/AccountManager";
import type { NeonAuthClient } from "../../src/boundary/NeonAuthClient";

// checkPassword は Neon Auth を使わないので、ログインの窓口はダミーでよい
const manager = new AccountManager(null as unknown as NeonAuthClient);
const check = (p: string) => manager.checkPassword(p);

describe("checkPassword：使えるパスワード", () => {
  it("8文字（いちばん短い）", () => expect(check("abcd1234")).toBe(true));
  it("16文字（いちばん長い）", () => expect(check("abcdefgh12345678")).toBe(true));
  it("大文字が入っていてもよい", () => expect(check("Runndesu2026")).toBe(true));
});

describe("checkPassword：使えないパスワード", () => {
  it("7文字（短すぎる）", () => expect(check("abc1234")).toBe(false));
  it("17文字（長すぎる）", () => expect(check("abcdefgh123456789")).toBe(false));
  it("英字だけ", () => expect(check("abcdefgh")).toBe(false));
  it("数字だけ", () => expect(check("12345678")).toBe(false));
  it("空", () => expect(check("")).toBe(false));
  it("全角の英数字（半角の英字・数字がない）", () => expect(check("ａｂｃｄ１２３４")).toBe(false));
});
