// テストの4画面（G008〜G011）で使う共通のもの（11/23：Tests.tsx を画面ごとのファイルに分けたときに、ここにまとめた）
import { TestType } from "../enums/TestType";

/** テストの種類の名前（画面に出す） */
export const KIND: Record<TestType, string> = { [TestType.MEANING_TO_TERM]: "単語テスト（意味→用語）", [TestType.TERM_TO_MEANING]: "単語テスト（用語→意味）", [TestType.ESSAY]: "記述テスト" };
/** 作成画面（G008）で選べる種類の順番 */
export const KINDS = [TestType.MEANING_TO_TERM, TestType.TERM_TO_MEANING, TestType.ESSAY];
