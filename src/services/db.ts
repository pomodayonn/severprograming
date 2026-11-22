// 前の保存場所に残っているデータを消す所。
//
// 【このファイルで何が起きているか】
// ・removeOldData：前の保存場所に残っているデータを消す（ページを開いたときに app.tsx が呼ぶ）
// 科目・ノート・テスト・資料は、すべて Manager（dao/idb.ts の "runndesu-data"）が保存する。
// 11/21（福山）：前はここにも保存していた（localStorage の「runndesu.data.学生ID」と IndexedDB の "runndesu"）。
//   引っ越しはやめた（チームでデータは消えてよいと決めた）ので、残っている分は removeOldData() で消す
// 11/22：お試しログイン（端末の中だけのアカウント）をなくしたので、そのアカウントとセッションも消す

/** お試しログインで使っていた localStorage のキー（アカウント一覧・ログイン中の印） */
const OLD_TRIAL_KEYS = ["runndesu.local-accounts", "runndesu.session"];

/** 前の保存場所（localStorage の「runndesu.data.学生ID」・お試しログイン、IndexedDB の "runndesu"）に残っているデータを消す。失敗しても何もしない */
export async function removeOldData(): Promise<void> {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("runndesu.data.") || OLD_TRIAL_KEYS.includes(k)) localStorage.removeItem(k);
  } catch { /* localStorage が使えない */ }
  try { indexedDB.deleteDatabase("runndesu"); } catch { /* IndexedDB が使えない */ }
}
