# るんです。（Vite + React + TypeScript）

外部設計書 v1.0（あどれなりん）と要件定義書にそろえた画面（G001〜G011）。

```
npm install
npm run dev      # 開発
npm run build    # 型チェック + 本番ビルド
```

## ローカルで動かす
- フロントに必要な値（Neon Auth・Neon Data API・サーバーの URL）は `.env.development` に入っているので、`npm install` → `npm run dev` だけで動く（ログインは Neon のアカウント）
- 自分だけ値を変えたいときは `.env.example` を `.env.development.local` にコピーして書きかえる（GitHub には上がらない）
- サーバー（`server` フォルダ）も動かしたい人は、`server/.env` の値をチームの福山に聞く

## 画面と部品の対応
| 画面 | ファイル |
|---|---|
| 共通の外枠（紫のヘッダー・ログアウト・左の階層・右サイド） | `components/Shell.tsx` |
| G001 ログイン / G002 新規登録（ログインID＋パスワード＋再入力） | `components/Auth.tsx` |
| G003 科目一覧（科目の作成・名前の編集・削除） | `components/SubjectList.tsx` |
| G004 学習画面（階層／部品、ノート、関連図／目次、資料・AI・テスト一覧・模擬テストのボタン） | `components/Study.tsx` + `NoteCanvas.tsx` + `RelationGraph.tsx` |
| G005 資料表示 / G006 文字起こし修正 | `components/Material.tsx` |
| G007 送信内容・提案確認（AIに送る内容の編集と、提案の確認） | `components/AiSend.tsx` |
| G008 テスト作成 / G009 解答 / G010 結果 / G011 一覧 | `components/Tests.tsx` |

## 差し替え口（実装時にここだけ置き換える）
- `services/ai.ts`：AI機能の窓口。サーバー経由でAIサービスを利用する。API未設定時の仮AIは開発環境に限定し、本番環境では設定エラーとする。
- `services/ocr.ts`：文字起こし（いまは仮実装。実装時は Tesseract.js など、ブラウザの中で処理）
- `services/db.ts`：前の保存場所に残っているデータを消すだけ（保存は Manager → `dao/` の IndexedDB、アカウントへの同期は `SyncManager`）
- `state/app.tsx`：ログイン中の学生・画面遷移・未保存ノートの確認・ダイアログ

## 決めごと（打ち合わせ・外部設計書より）
- ログインしないと使えない。データは学生ごとに端末へ保存し、ログアウトしても消さない
- ノートは「保存」を押したときだけ保存。未保存のまま別の画面へ移ろうとすると確認が出る
- AIは1日20回まで。1万文字を超えると分けて送り、回数を余分に消費する
- 単語テストはAIを使わない。採点は「意味→用語」だけ（全角半角・大文字小文字・前後の空白は区別せず全体一致）
- 解き直しの解答は保存しない。過去の結果は、テストを選んでそのまま見る
