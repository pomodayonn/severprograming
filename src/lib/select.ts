// 画面が beans の中から「欲しいもの」を探すための小さな関数（11/21 道B）
//
// 【このファイルで何が起きているか】
// 画面は Controller（G003:loadSubjects）から、科目・学習項目・前提項目・ノート・テスト・資料を beans のまま受け取る。
// beans は表（テーブル）と同じで、入れ子になっていない（科目の中に学習項目が入っているわけではない）。
// そこで「この科目の学習項目」「この学習項目のノート」のように、IDで探す関数をここにまとめた。
// 形を変える（変換する）のではなく、探すだけ。SQL の WHERE と同じ考え方
import type { LearningItem } from "../beans/LearningItem";
import type { Subject } from "../beans/Subject";
import { norm } from "./logic";
import type { Prerequisite } from "../beans/Prerequisite";
import type { Note } from "../beans/Note";
import type { NotePart } from "../beans/NotePart";
import type { Test } from "../beans/Test";
import type { Question } from "../beans/Question";
import type { Attempt } from "../beans/Attempt";
import type { Answer } from "../beans/Answer";
import { TestType } from "../enums/TestType";

const NO_PARTS: readonly NotePart[] = [];

/** その科目の学習項目（作った順） */
export const itemsOf = (items: readonly LearningItem[], subjectId: string | undefined): LearningItem[] =>
  items.filter(i => i.subjectId === subjectId);

/** その学習項目の前提になっている学習項目のID */
export const prereqIdsOf = (prerequisites: readonly Prerequisite[], itemId: string): string[] =>
  prerequisites.filter(p => p.itemId === itemId).map(p => p.prereqItemId);

/** その学習項目のノートの部品（ノートがなければ空） */
export const partsOf = (notes: readonly Note[], itemId: string | undefined): readonly NotePart[] =>
  notes.find(n => n.itemId === itemId)?.parts ?? NO_PARTS;

/** テストの問題（問題番号の順） */
export const questionsOf = (test: Test): Question[] => [...test.questions].sort((a, b) => a.number - b.number);

/** テストの受験（1回目から順に） */
export const attemptsOf = (test: Test): Attempt[] => [...test.attempts].sort((a, b) => a.attemptNo - b.attemptNo);

/** その受験の中の、その問題への解答（なければ undefined） */
export const answerOf = (attempt: Attempt | undefined, questionId: string): Answer | undefined =>
  attempt?.answers.find(a => a.questionId === questionId);

/** いちばん新しい受験の点数（11/23）。採点のある「意味→用語」で、1回以上解いたときだけ。それ以外は null */
export function lastScore(test: Test): { ok: number; total: number; attemptNo: number } | null {
  if (test.testType !== TestType.MEANING_TO_TERM || !test.attempts.length) return null;
  const all = attemptsOf(test), last = all[all.length - 1];
  return { ok: last.answers.filter(a => a.correct).length, total: test.questions.length, attemptNo: last.attemptNo };
}

/** 名前に検索の言葉が入っているか（全角半角・大文字小文字は区別しない） */
export const nameHas = (name: string, q: string) => norm(name).includes(norm(q));

/**
 * 左の一覧の検索（11/23）。言葉が空なら null（全部出す）。
 * 科目名に入っていれば、その科目の学習項目を全部出す。入っていなければ、名前に入っている学習項目だけを出す。
 * どちらもなければ、その科目は出さない
 */
export function searchTree(subjects: readonly Subject[], items: readonly LearningItem[], q: string): Map<string, LearningItem[]> | null {
  if (!q.trim()) return null;
  const out = new Map<string, LearningItem[]>();
  for (const s of subjects) {
    const its = itemsOf(items, s.subjectId);
    const hit = nameHas(s.subjectName, q) ? its : its.filter(i => nameHas(i.itemName, q));
    if (hit.length || nameHas(s.subjectName, q)) out.set(s.subjectId, hit);
  }
  return out;
}
