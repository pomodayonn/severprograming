# るんです。（Vite + React + TypeScript）

```
npm install
npm run dev      # 開発
npm run build    # 型チェック + 本番ビルド
```

## 構成
| 場所 | 役割 |
|---|---|
| `src/types.ts` | データの型（運営教材も自分の教材も同じ `Subject → Item`） |
| `src/lib/logic.ts` | 純粋ロジック：復習度・記憶の残り具合・枠(ブロック)の取り出し・問題と解答の組み立て |
| `src/lib/seed.ts` | クラウド教材のサンプルと初期データ（実装時はAPI/GitHubから取得に置き換え） |
| `src/services/ai.ts` | **AIの差し替え口**（いまは仮実装 `mockAI`） |
| `src/services/ocr.ts` | **文字読み取りの差し替え口**（精度 < 0.8 のときの案内UIは `SrcPanel`） |
| `src/services/storage.ts` | 端末 / サーバー保存。旧版(素のJS)と同じキー `manabi-v2` なので、いまのデータをそのまま読める |
| `src/state/store.tsx` | `useReducer` + Context。入力中の文字など一時的な状態は各コンポーネントの `useState` |
| `src/components/NoteEditor.tsx` | ノート（枠・見出し・目次・全画面・カーソル位置への挿入）。TipTap等に替えるならここだけ |
| `src/components/Graph.tsx` | つながりマップ（色=記憶、大きさ=回数、顔=表情） |

## まだ移していないもの（旧 `runndesu.html` にはある）
検索パレット(Ctrl+K) / 問題・公式・解法一覧 / 模擬テスト / 初回の案内 / ログイン画面 / 整える（名前変更・削除・並べ替え・元に戻す）/ 前提項目の編集 / 保存先の切り替えUI / ホーム画面のドーナツ・棒グラフ
