// 単語枠の「用語：意味」の文字と、単語のリストを行き来する（11/21 リファクタリング）
//
// 【このファイルで何が起きているか】
// 単語枠は、AIに送るときや提案を見せるときは「用語：意味」を1行ずつ並べた文字にし、
// ノートに入れるときは { term, meaning } のリストに戻す。
// 前はこの変換が6か所に別々に書いてあって区切り方がそろっておらず、
// 「集合時刻：12:30」の意味が「1230」になるなど、意味の中の文字が消えることがあった。ここ1か所にまとめた
import type { Word } from "../types";

/** 単語のリストを「用語：意味」の行にする（1行に1単語） */
export const wordsToText = (words: readonly Word[]): string => words.map(w => `${w.term}：${w.meaning}`).join("\n");

/**
 * 1行を用語と意味に分ける。区切りは最初の「：」か「:」。どちらもなければ最初の「とは」。
 * 区切りが2つ目以降にあっても、意味の一部として残す（例：「集合時刻：12:30」→ 用語「集合時刻」・意味「12:30」）。
 * 区切りがない行は、用語だけで意味は空にする
 */
export function lineToWord(line: string): Word {
  const l = line.trim();
  const m = /[：:]/.exec(l) ?? /とは/.exec(l);
  if (!m) return { term: l, meaning: "" };
  return { term: l.slice(0, m.index).trim(), meaning: l.slice(m.index + m[0].length).trim() };
}

/** 「用語：意味」の行を単語のリストにする（空の行は飛ばす） */
export const textToWords = (text: string): Word[] => text.split("\n").filter(l => l.trim()).map(lineToWord);
