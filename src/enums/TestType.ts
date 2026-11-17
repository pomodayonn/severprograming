// TestType（列挙型／フロントエンド）：テストの種類
// 担当：。値は Neon の test.test_type と同じ
// 【このファイルで何が起きているか】
// テストの種類を、決まった3つの名前だけに限るための「列挙型（enum）」です。
// TestManager は、この種類を見て「採点するか」「AIで作るか」を決める
export enum TestType {
  /** 単語テスト（意味→用語）。採点する */
  MEANING_TO_TERM = "MEANING_TO_TERM",
  /** 単語テスト（用語→意味）。採点しない */
  TERM_TO_MEANING = "TERM_TO_MEANING",
  /** 記述テスト（AIで作る）。採点しない */
  ESSAY = "ESSAY",
}