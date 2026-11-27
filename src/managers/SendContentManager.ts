// SendContentManager（Entity Manager／フロントエンド）
// AIに送る内容を1回あたり1万文字以内に分割する。
// 分割処理は lib/logic.ts に共通化する。

import type { SendContent } from "../beans/SendContent";
import { splitAiText } from "../lib/logic";

export class SendContentManager {
  /** なるべく改行の位置で文章を分割する */
  split(content: SendContent): string[] {
    return splitAiText(content.text);
  }
}