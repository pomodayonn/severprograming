// タブの並び（11/23：学習画面・内容編集で同じ書き方をしていたものを1つにまとめた）
//
// 【このファイルで何が起きているか】
// 「階層／ノートの部品」「関連図／目次」のような、上の見出しのタブを並べる。
// tabs に [値, 表示する名前] を並べて渡すと、いま選んでいる value のタブに印（.chip.on）が付く。
// タブの右に何か置きたいとき（「全画面」ボタンや「決定」ボタンなど）は、children に渡す
import type { ReactNode } from "react";

interface Props<K extends string> { tabs: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; children?: ReactNode }
export function Tabs<K extends string>({ tabs, value, onChange, children }: Props<K>) {
  return (<div className="tabs">
    {tabs.map(([k, label]) => <button key={k} className={"chip" + (value === k ? " on" : "")} onClick={() => onChange(k)}>{label}</button>)}
    {children}</div>);
}
