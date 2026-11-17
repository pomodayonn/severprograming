// 【このファイルで何が起きているか】
// アイコンを1つ描く部品です。例：<Icon n="cloud" />（絵は lib/icons.ts にある）
import { ICONS } from "../lib/icons";
export function Icon({ n, s = 18 }: { n: string; s?: number }) {
  return <svg className="ic" viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[n] ?? "" }} />;
}
