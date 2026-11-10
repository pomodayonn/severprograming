// TestType（列挙型／フロントエンド）：テストの種類
// 担当：野中（作成：東 11/10）。値は Neon の test.test_type と同じ
export enum TestType {
  /** 単語テスト（意味→用語）。採点する */
  MEANING_TO_TERM = "MEANING_TO_TERM",
  /** 単語テスト（用語→意味）。採点しない */
  TERM_TO_MEANING = "TERM_TO_MEANING",
  /** 記述テスト（AIで作る）。採点しない */
  ESSAY = "ESSAY",
}