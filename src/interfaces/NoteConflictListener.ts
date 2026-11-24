// NoteConflictListener（インターフェース／フロントエンド）：ノートの食い違いを知らせてもらう係（11/24、UC-018 代替フロー(2)）
//
// 【このファイルで何が起きているか】
// Java の ActionListener と同じ考え方。画面がこれを実装したものを Controller.setNoteConflictListener() に渡しておくと、
// SyncManager がノートをアカウントに送ろうとして「別の端末でより新しく保存されている」と分かったときに onNoteConflict が呼ばれる。
// 画面は「上書きして保存」「別の端末の内容にする」を出して、選ばれたほうで Controller の G004:resolveNoteConflict を呼ぶ。
// 送るのは「保存」を押したときだけでなく、ネットにつながり直したとき・「最新にする」を押したときなどもあるので、そのたびに知らせが来る
export interface NoteConflict {
  /** ノートID */
  noteId: string;
  /** 学習項目ID（G004:resolveNoteConflict に渡す） */
  itemId: string;
  /** 学習項目名（どのノートか、画面に出すため） */
  itemName: string;
}

export interface NoteConflictListener {
  /** 食い違っているノートが見つかるたびに呼ばれる */
  onNoteConflict(conflicts: NoteConflict[]): void;
}
