// AiPrompts（Service／バックエンド）：AIへの頼み方（プロンプト）と、返事の読み取り方をまとめたもの
//
// 【このファイルで何が起きているか】
// ・build〇〇：AIに送る文章（プロンプト）を作る
// ・read〇〇：AIの返事（文字列）から JSON を取り出し、フロントとの約束（docs/API.md）の形になっているか確かめる
//   形がおかしければ例外を投げる → AiService が次のAIを試す
// ・splitText / countCalls：1万文字ごとに分ける・何回分かを数える（フロントの SendContentManager と同じ決まり）
// プロンプトを直したいときは、このファイルだけ変えればよい

export const SEND_LIMIT = 10000; // 1回に送れる文字数
export const MAX_COUNT = 20; // 記述テストの問題数の上限（DB の question_count と同じ）

/** 枠の種類と、AIに伝える説明 */
export const FRAME_TYPES = {
  word: "単語枠：大事な用語と、その意味",
  problem: "問題枠：内容に出てくる問題・問い",
  formula: "公式枠：公式・定理・決まりごと",
  answer: "解答枠：問題の答え",
  method: "解き方枠：解き方・手順",
  summary: "要約枠：内容の要点を短くまとめたもの",
};

/** 文字数（日本語も絵文字も1文字ずつ） */
export const lengthOf = (s) => [...s].length;

/** 何回分か（organize・essay-test 用）：ceil(文字数 / 1万)。最低1回 */
export const countCalls = (text) => Math.max(1, Math.ceil(lengthOf(text) / SEND_LIMIT));

/** 1万文字ごとに分ける。なるべく改行の所で切る（フロントの SendContentManager.split と同じ） */
export function splitText(text) {
  const chars = [...text];
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let end = Math.min(start + SEND_LIMIT, chars.length);
    if (end < chars.length) {
      const nl = chars.slice(start, end).lastIndexOf("\n");
      if (nl > SEND_LIMIT * 0.8) end = start + nl + 1;
    }
    out.push(chars.slice(start, end).join(""));
    start = end;
  }
  return out.length ? out : [""];
}

/** 学生の文章を、指示と混ざらないように区切って入れる */
const block = (label, text) => `<<<${label}\n${text}\n${label}>>>`;

// ---------- 返事から JSON を取り出す ----------

/** 返事の中の最初の { から最後の } までを JSON として読む（```json などで囲まれていても読める） */
export function parseJson(reply) {
  const s = reply.indexOf("{");
  const e = reply.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("返事に JSON がありません");
  return JSON.parse(reply.slice(s, e + 1));
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** { q, a } の形になっているか確かめて、きれいにして返す。だめなら null */
function toQuestion(v) {
  const q = str(v?.q);
  const a = str(v?.a);
  return q && a ? { q, a } : null;
}

// ---------- organize（ノートまとめ） ----------

export function buildOrganize(text, frameTypes) {
  const kinds = frameTypes.map((ft) => `- ${ft}（${FRAME_TYPES[ft]}）`).join("\n");
  return `次の「送る内容」を読んで、ノートの枠ごとに整理してください。

使う枠の種類（ft）は次のものだけです：
${kinds}

決まり：
- 送る内容に書かれていることだけを使う。書かれていないことは足さない
- 当てはまる内容がない枠は出さない
- word（単語枠）は "words" に用語（term）と意味（meaning）を入れ、"text" は空文字にする
- ほかの枠は "text" に文章を入れる（改行してよい）
- 日本語で書く
- 次の JSON だけを返す（説明やコードブロックは付けない）
{"proposals":[{"ft":"summary","text":"..."},{"ft":"word","text":"","words":[{"term":"...","meaning":"..."}]}]}

${block("送る内容", text)}`;
}

/**
 * AIの返事を、約束の形の proposals にする
 * ・frameTypes にない種類は捨てる
 * ・同じ種類が2つ以上来たら1つにまとめる
 * ・同じ種類の枠がノートにすでにあれば、その id を targetId に入れる
 */
export function readOrganize(reply, frameTypes, frames) {
  const list = parseJson(reply)?.proposals;
  if (!Array.isArray(list)) throw new Error("proposals がありません");
  /** @type {Map<string, {ft: string, text: string, words?: {term: string, meaning: string}[]}>} */
  const byType = new Map();
  for (const p of list) {
    const ft = str(p?.ft);
    if (!frameTypes.includes(ft)) continue;
    const cur = byType.get(ft) ?? (ft === "word" ? { ft, text: "", words: [] } : { ft, text: "" });
    if (ft === "word") {
      for (const w of Array.isArray(p.words) ? p.words : []) {
        const term = str(w?.term);
        const meaning = str(w?.meaning);
        if (term && meaning) cur.words.push({ term, meaning });
      }
    } else {
      const t = str(p.text);
      if (t) cur.text = cur.text ? `${cur.text}\n${t}` : t;
    }
    byType.set(ft, cur);
  }
  const proposals = [...byType.values()]
    .filter((p) => (p.ft === "word" ? p.words.length > 0 : p.text))
    .map((p) => {
      const target = frames.find((f) => f.ft === p.ft);
      return target ? { ...p, targetId: target.id } : p;
    });
  return proposals;
}

/** 分けて送った分の proposals を1つにまとめる（同じ種類はくっつける） */
export function mergeProposals(lists) {
  const byType = new Map();
  for (const p of lists.flat()) {
    const cur = byType.get(p.ft);
    if (!cur) byType.set(p.ft, { ...p, ...(p.words ? { words: [...p.words] } : {}) });
    else if (p.ft === "word") cur.words.push(...p.words);
    else cur.text = `${cur.text}\n${p.text}`;
  }
  return [...byType.values()];
}

// ---------- essay-test（記述テストを作る） ----------

export function buildEssay(text, count) {
  return `次の「送る内容」から、記述式の問題を ${count} 問作ってください。

決まり：
- 送る内容に書かれていることだけで答えられる問題にする
- "q" は問題文、"a" は模範解答（2〜4文くらい）
- 同じことを聞く問題を重ねない
- 日本語で書く
- 次の JSON だけを返す（説明やコードブロックは付けない）
{"questions":[{"q":"...","a":"..."}]}

${block("送る内容", text)}`;
}

/** AIの返事から問題を取り出す（多すぎたら count 問に切る。1問もなければ失敗） */
export function readEssay(reply, count) {
  const list = parseJson(reply)?.questions;
  if (!Array.isArray(list)) throw new Error("questions がありません");
  const questions = list.map(toQuestion).filter(Boolean).slice(0, count);
  if (!questions.length) throw new Error("問題が1問もありません");
  return questions;
}

/** 問題数を、分けた内容の数に配る（例：10問を3つに → 4,3,3）。0問になる分はない前提（count >= 1） */
export function shareCount(count, parts) {
  return Array.from({ length: parts }, (_, i) => Math.floor(count / parts) + (i < count % parts ? 1 : 0));
}

// ---------- explain（解説） ----------

export function buildExplain(question, extra) {
  return `次の記述問題について、学生向けの解説を書いてください。

決まり：
- 模範解答のどこが大事か、なぜそうなるのかを、やさしい言葉で説明する
- 長さは300〜600文字くらい
- 日本語で書く
${extra ? "- 下の「追加の指示」にも従う\n" : ""}- 次の JSON だけを返す（説明やコードブロックは付けない）
{"explanation":"..."}

${block("問題文", question.q)}
${block("模範解答", question.a)}
${extra ? block("追加の指示", extra) : ""}`;
}

export function readExplain(reply) {
  const explanation = str(parseJson(reply)?.explanation);
  if (!explanation) throw new Error("explanation がありません");
  return explanation;
}

// ---------- regenerate-question（1問を作り直す） ----------

export function buildRegenerate(question, extra) {
  return `次の記述問題を作り直してください。

決まり：
- 聞いている内容（範囲）は変えない
- "q" は新しい問題文、"a" は新しい模範解答
- 日本語で書く
${extra ? "- 下の「追加の指示」に従う\n" : "- 前の問題と言い回しを変える\n"}- 次の JSON だけを返す（説明やコードブロックは付けない）
{"question":{"q":"...","a":"..."}}

${block("前の問題文", question.q)}
${block("前の模範解答", question.a)}
${extra ? block("追加の指示", extra) : ""}`;
}

export function readRegenerate(reply) {
  const q = toQuestion(parseJson(reply)?.question);
  if (!q) throw new Error("question の形がおかしいです");
  return q;
}