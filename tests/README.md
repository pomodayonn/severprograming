# テスト（tests/）

## 単体テスト（tests/unit/）

`npm test` で全部まとめて動きます（Vitest）。どれも画面や Neon・Render を使わない、関数1つずつのテストです。

| ファイル | 確かめること | 進捗表の担当 |
|---|---|---|
| `checkPassword.test.ts` | パスワードの条件（8〜16文字・英字と数字の両方） | 東 |
| `wouldCycle.test.ts` | 前提項目が輪にならないか | 東 |
| `split.test.ts` | AIに送る内容を1万文字ごとに分ける・利用回数の数え方 | 黒木 |
| `gradeMeaningToTerm.test.ts` | 「意味→用語」の採点（全角半角・大文字小文字・前後の空白） | 黒木 |
| `words.test.ts` | 単語枠の「用語：意味」の分け方（前に「12:30」が「1230」になったバグの再発防止） | ― |

初めて動かすときは、先に `npm install` をしてください（Vitest が入ります）。
テストのファイルは `src/` の外にあるので、`npm run build` には影響しません。
