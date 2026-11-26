// つながりの設定（11/26）：開いている学習項目の「前に学ぶ項目」と「次に学ぶ項目」をまとめて決める窓
//
// 【このファイルで何が起きているか】
// 関連図の線（前提項目）を決める窓です。左の「つながりの設定」と、右の関連図の「つなぐ」から開く。
// ・1行に1つの学習項目。行ごとに「前に学ぶ」「次に学ぶ」を押して選ぶ（片方を選ぶと、もう片方は外れる）
// ・項目は名前の順。上の欄で名前を探せる
// ・「確定」で Controller（G004:setPrerequisites）に送る。輪になるときはエラーの文を出して、窓は閉じない
// ・Esc か「やめる」で閉じる（何も変えない）
import { useEffect, useMemo, useRef, useState } from "react";
import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import { byName } from "../lib/logic";
import { nameHas, nextIdsOf, prereqIdsOf } from "../lib/select";

interface Props {
  item: LearningItem; items: LearningItem[]; prerequisites: readonly Prerequisite[];
  onClose: () => void;
  /** 保存する。うまくいかなかったときはエラーの文を返す */
  onSave: (before: string[], after: string[]) => Promise<string | undefined>;
}
type Side = "before" | "after";

export function LinkDialog({ item, items, prerequisites, onClose, onSave }: Props) {
  const [before, setBefore] = useState(() => prereqIdsOf(prerequisites, item.itemId));
  const [after, setAfter] = useState(() => nextIdsOf(prerequisites, item.itemId));
  const [q, setQ] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const others = useMemo(() => byName(items.filter(i => i.itemId !== item.itemId)), [items, item.itemId]);
  const shown = others.filter(i => nameHas(i.itemName, q));
  const nameOf = (id: string) => items.find(i => i.itemId === id)?.itemName ?? "";
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  /** 行の「前に学ぶ」「次に学ぶ」を押したとき。同じ項目は片方にしか入らない */
  const flip = (id: string, side: Side) => {
    setErr("");
    const on = (side === "before" ? before : after).includes(id);
    const drop = (xs: string[]) => xs.filter(x => x !== id);
    if (side === "before") { setBefore(on ? drop(before) : [...before, id]); setAfter(drop(after)); }
    else { setAfter(on ? drop(after) : [...after, id]); setBefore(drop(before)); }
  };
  const ok = async () => {
    setBusy(true); const e = await onSave(before, after); setBusy(false);
    if (e) setErr(e);
  };
  const list = (ids: string[]) => ids.length ? ids.map(nameOf).join("、") : "なし";
  return (
    <div className="ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg links" role="dialog" aria-label={`「${item.itemName}」のつながり`}>
        <h3>「{item.itemName}」のつながり</h3>
        <p className="mute">関連図の矢印は「先に学ぶ → あとで学ぶ」の向きです。</p>
        <div className="lkflow" aria-live="polite">
          <span className="lkb">前に学ぶ：{list(before)}</span><span className="lka">→</span>
          <b>{item.itemName}</b><span className="lka">→</span>
          <span className="lkn">次に学ぶ：{list(after)}</span>
        </div>
        <input ref={search} className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="学習項目の名前で探す" aria-label="学習項目の名前で探す" />
        <div className="lklist" role="table">
          <div className="lkrow lkhd" role="row"><span role="columnheader">学習項目（名前の順）</span><span role="columnheader">前に学ぶ</span><span role="columnheader">次に学ぶ</span></div>
          {shown.map(i => { const b = before.includes(i.itemId), a = after.includes(i.itemId); return (
            <div key={i.itemId} className={"lkrow" + (b ? " isb" : a ? " isa" : "")} role="row">
              <span className="lknm" role="cell" title={i.itemName}>{i.itemName}</span>
              <span role="cell"><button className={"lkt b" + (b ? " on" : "")} aria-pressed={b} onClick={() => flip(i.itemId, "before")} title={`「${i.itemName}」を「${item.itemName}」より先に学ぶ`}>{b ? "✓ " : ""}前</button></span>
              <span role="cell"><button className={"lkt a" + (a ? " on" : "")} aria-pressed={a} onClick={() => flip(i.itemId, "after")} title={`「${i.itemName}」を「${item.itemName}」のあとに学ぶ`}>{a ? "✓ " : ""}次</button></span>
            </div>); })}
          {!shown.length && <p className="mute" style={{ padding: "6px 4px" }}>{others.length ? "その名前の学習項目はありません。" : "ほかの学習項目がまだありません。"}</p>}
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row"><button className="btn line" onClick={onClose}>やめる</button><button className="btn pri" disabled={busy} onClick={ok}>確定</button></div>
      </div>
    </div>);
}
