// SendContentManager（Entity Manager／フロントエンド）：AIに送る内容を作る専用のクラス
// 担当：）。ノートまとめと記述テスト作成の両方で使う（どちらも G007 の画面）
import { SendContent } from "../beans/SendContent";
import type { NotePart } from "../beans/NotePart";
import { PartType } from "../enums/PartType";
import type { MaterialDAO } from "../dao/MaterialDAO";
import type { NoteDAO } from "../dao/NoteDAO";
import { fetchRemaining } from "../services/ai";

/** 1回に送れる文字数（これを超えると分けて送り、その分だけ利用回数を使う） */
export const SEND_LIMIT = 10000;

/** 枠の中身を文字にする（単語枠は「用語：意味」を1行ずつ） */
export const partText = (p: NotePart): string =>
  p.partType === PartType.FRAME && p.frameType === "word" ? p.words.map(w => `${w.term}：${w.meaning}`).join("\n") : p.text;

export class SendContentManager {
  constructor(private readonly materialDAO: MaterialDAO, private readonly noteDAO: NoteDAO) {}

  /**
   * 選んだ文字起こしとノートの部品をコピーして、送る内容を作る（元のデータは変わらない）。
   * 部品を探すために、学習項目ID（itemId）も渡す
   */
  async createContent(itemId: string, materialIds: string[], partIds: string[]): Promise<SendContent> {
    const texts: string[] = [];
    for (const id of materialIds) {
      const c = await this.materialDAO.findContent(id);
      if (typeof c === "string" && c.trim()) texts.push(c.trim()); // 文字起こし・テキストだけ（画像・PDF はそのままでは送れない）
    }
    const note = await this.noteDAO.findByItem(itemId);
    for (const id of partIds) {
      const p = note?.parts.find(x => x.partId === id);
      if (p && partText(p).trim()) texts.push(partText(p).trim());
    }
    return this.editText(new SendContent({ materialIds: [...materialIds], partIds: [...partIds] }), texts.join("\n\n"));
  }

  /** 送る前に内容を編集・削除する（新しい SendContent を返す） */
  editText(content: SendContent, text: string): SendContent {
    return new SendContent({ ...content, text, charCount: [...text].length });
  }

  /** 1万文字ごとに1回として、何回分の利用になるかを計算する（空でも1回） */
  countCalls(content: SendContent): number {
    return Math.max(1, Math.ceil(content.charCount / SEND_LIMIT));
  }

  /** 今日の残り回数をサーバーに聞く（サーバーがないときは null） */
  async getRemaining(): Promise<number | null> { return fetchRemaining(); }

  /** 残り回数が足りるかを返す（足りなければ「このまま送信」を選べない）。残りが分からないときは true */
  async canSend(content: SendContent): Promise<boolean> {
    if (!content.text.trim()) return false;
    const r = await this.getRemaining();
    return r === null || this.countCalls(content) <= r;
  }

  /** 1万文字を超えたときに、内容を1万文字ごとに分ける。なるべく改行の所で切る */
  split(content: SendContent): string[] {
    const chars = [...content.text], out: string[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = Math.min(start + SEND_LIMIT, chars.length);
      if (end < chars.length) { // 後ろ2割の中で一番最後の改行で切る
        const nl = chars.slice(start, end).lastIndexOf("\n");
        if (nl > SEND_LIMIT * 0.8) end = start + nl + 1;
      }
      out.push(chars.slice(start, end).join("")); start = end;
    }
    return out.length ? out : [""];
  }
}