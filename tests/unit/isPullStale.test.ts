// 単体テスト：isPullStale（ページを開き直したとき、アカウントから受け取り直すか）
// 前回受け取ってから30分以内なら受け取らず、端末のデータをそのまま使う（11/23）
import { describe, expect, it } from "vitest";
import { isPullStale, PULL_MAX_AGE_MS } from "../../src/lib/logic";

const base = Date.parse("2026-11-23T12:00:00.000Z");
const ago = (ms: number) => new Date(base - ms).toISOString();

describe("isPullStale：受け取り直すかどうか", () => {
  it("まだ受け取ったことがなければ受け取る", () => {
    expect(isPullStale(null, base)).toBe(true);
    expect(isPullStale(undefined, base)).toBe(true);
    expect(isPullStale("", base)).toBe(true);
  });
  it("30分以内なら受け取らない", () => {
    expect(isPullStale(ago(0), base)).toBe(false);
    expect(isPullStale(ago(29 * 60 * 1000), base)).toBe(false);
  });
  it("ちょうど30分たったら受け取る", () => expect(isPullStale(ago(PULL_MAX_AGE_MS), base)).toBe(true));
  it("30分より前なら受け取る", () => expect(isPullStale(ago(2 * 60 * 60 * 1000), base)).toBe(true));
  it("時刻が読めないときは、念のため受け取る", () => expect(isPullStale("きのう", base)).toBe(true));
  it("端末の時計が戻って未来の時刻になっていたら、念のため受け取る", () => expect(isPullStale(ago(-5 * 60 * 1000), base)).toBe(true));
  it("長さを変えられる", () => expect(isPullStale(ago(6 * 60 * 1000), base, 5 * 60 * 1000)).toBe(true));
});
