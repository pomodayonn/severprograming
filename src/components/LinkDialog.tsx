// つながりの設定（11/26）：開いている学習項目の「前に学ぶ項目」と「次に学ぶ項目」をまとめて決める窓
//
// 【このファイルで何が起きているか】
// 関連図の線（前提項目）を決める窓です。
// ・項目ごとに「前に学ぶ」「次に学ぶ」を選ぶ
// ・項目は名前の順。上の欄で名前を探せる
// ・「確定」で Controller に送る
// ・保存中は重複操作やキャンセルを防止する
// ・保存に失敗した場合はエラーを表示して操作を再開できるようにする

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LearningItem } from "../beans/LearningItem";
import type { Prerequisite } from "../beans/Prerequisite";
import { byName } from "../lib/logic";
import {
  nameHas,
  nextIdsOf,
  prereqIdsOf,
} from "../lib/select";

interface Props {
  item: LearningItem;
  items: LearningItem[];
  prerequisites: readonly Prerequisite[];
  onClose: () => void;

  /** 保存する。失敗した場合はエラーメッセージを返す */
  onSave: (
    before: string[],
    after: string[]
  ) => Promise<string | undefined>;
}

type Side = "before" | "after";

export function LinkDialog({
  item,
  items,
  prerequisites,
  onClose,
  onSave,
}: Props) {
  const [before, setBefore] = useState(
    () => prereqIdsOf(prerequisites, item.itemId)
  );

  const [after, setAfter] = useState(
    () => nextIdsOf(prerequisites, item.itemId)
  );

  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useRef<HTMLInputElement>(null);

  // React の再描画を待たずに重複保存を防止する。
  const saving = useRef(false);

  // 保存中はダイアログを閉じない。
  const close = useCallback(() => {
    if (saving.current) return;
    onClose();
  }, [onClose]);

  const others = useMemo(
    () => byName(
      items.filter(i => i.itemId !== item.itemId)
    ),
    [items, item.itemId]
  );

  const shown = others.filter(
    i => nameHas(i.itemName, q)
  );

  const nameOf = (id: string) =>
    items.find(i => i.itemId === id)?.itemName ?? "";

  useEffect(() => {
    search.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  /** 同じ学習項目は前・次の片方にしか入れない */
  const flip = (id: string, side: Side) => {
    if (saving.current) return;

    setErr("");

    const on = (
      side === "before" ? before : after
    ).includes(id);

    const drop = (xs: string[]) =>
      xs.filter(x => x !== id);

    if (side === "before") {
      setBefore(
        on ? drop(before) : [...before, id]
      );

      setAfter(drop(after));
    } else {
      setAfter(
        on ? drop(after) : [...after, id]
      );

      setBefore(drop(before));
    }
  };

  /** つながりを保存する */
  const ok = async () => {
    if (saving.current) return;

    saving.current = true;
    setBusy(true);
    setErr("");

    try {
      const error = await onSave(before, after);

      if (error) {
        setErr(error);
      }
    } catch {
      setErr(
        "保存結果を確認できませんでした。時間をおいて確認してください"
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const list = (ids: string[]) =>
    ids.length
      ? ids.map(nameOf).join("、")
      : "なし";

  return (
    <div
      className="ov"
      onMouseDown={e => {
        if (e.target === e.currentTarget) {
          close();
        }
      }}
    >
      <div
        className="dlg links"
        role="dialog"
        aria-busy={busy}
        aria-label={`「${item.itemName}」のつながり`}
      >
        <h3>
          「{item.itemName}」のつながり
        </h3>

        <p className="mute">
          関連図の矢印は「先に学ぶ → あとで学ぶ」の向きです。
        </p>

        <div
          className="lkflow"
          aria-live="polite"
        >
          <span className="lkb">
            前に学ぶ：{list(before)}
          </span>

          <span className="lka">→</span>

          <b>{item.itemName}</b>

          <span className="lka">→</span>

          <span className="lkn">
            次に学ぶ：{list(after)}
          </span>
        </div>

        <input
          ref={search}
          className="inp"
          value={q}
          disabled={busy}
          onChange={e => setQ(e.target.value)}
          placeholder="学習項目を検索"
          aria-label="学習項目を検索"
        />

        <div className="lklist" role="table">
          <div
            className="lkrow lkhd"
            role="row"
          >
            <span role="columnheader">
              学習項目（名前の順）
            </span>

            <span role="columnheader">
              前に学ぶ
            </span>

            <span role="columnheader">
              次に学ぶ
            </span>
          </div>

          {shown.map(i => {
            const b = before.includes(i.itemId);
            const a = after.includes(i.itemId);

            return (
              <div
                key={i.itemId}
                className={
                  "lkrow" +
                  (b ? " isb" : a ? " isa" : "")
                }
                role="row"
              >
                <span
                  className="lknm"
                  role="cell"
                  title={i.itemName}
                >
                  {i.itemName}
                </span>

                <span role="cell">
                  <button
                    className={
                      "lkt b" + (b ? " on" : "")
                    }
                    disabled={busy}
                    aria-pressed={b}
                    onClick={() =>
                      flip(i.itemId, "before")
                    }
                    title={`「${i.itemName}」を「${item.itemName}」より先に学ぶ`}
                  >
                    {b ? "✓ " : ""}前
                  </button>
                </span>

                <span role="cell">
                  <button
                    className={
                      "lkt a" + (a ? " on" : "")
                    }
                    disabled={busy}
                    aria-pressed={a}
                    onClick={() =>
                      flip(i.itemId, "after")
                    }
                    title={`「${i.itemName}」を「${item.itemName}」のあとに学ぶ`}
                  >
                    {a ? "✓ " : ""}次
                  </button>
                </span>
              </div>
            );
          })}

          {!shown.length && (
            <p
              className="mute"
              style={{ padding: "6px 4px" }}
            >
              {others.length
                ? "該当する学習項目がありません。"
                : "ほかの学習項目がまだありません。"}
            </p>
          )}
        </div>

        {err && (
          <div className="err" role="alert">
            {err}
          </div>
        )}

        <div className="row">
          <button
            className="btn line"
            disabled={busy}
            onClick={close}
          >
            キャンセル
          </button>

          <button
            className="btn pri"
            disabled={busy}
            onClick={ok}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
