// SendContentManager（Entity Manager／フロントエンド）：AIに送る内容を、1回に送れる量（1万文字）ごとに分ける
// 担当：）。ノートまとめ（AiSummaryManager）で使う
//
// 【このファイルで何が起きているか】
// 1万文字を超えたら、なるべく改行の所で分ける（split）。分けた数だけAIの利用回数を使う
// 11/21 掃除：前は「送る内容を作る（createContent）」「残り回数で足りるか（canSend）」などもあったが、
//   どれも画面（G007）とサーバー（429 エラー）が担当していて使われていなかったので消した
import type { SendContent } from "../beans/SendContent";
import { SEND_LIMIT } from "./common";

export class SendContentManager {
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