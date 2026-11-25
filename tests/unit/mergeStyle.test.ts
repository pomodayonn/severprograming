// 単体テスト：AIの提案を反映するときの書式（NoteManager.mergeSuggestions）
// 文字が書きかわった枠では、前の文字ごとの書式を外す（位置がずれるため）。同じ文字なら書式は残す。そろえ方はいつも残す
import { describe, expect, it } from "vitest";
import { NoteManager } from "../../src/managers/NoteManager";
import { Note } from "../../src/beans/Note";
import { NotePart } from "../../src/beans/NotePart";
import { Suggestion } from "../../src/beans/Suggestion";
import { PartType } from "../../src/enums/PartType";

const nm = Object.create(NoteManager.prototype) as NoteManager;
const style = JSON.stringify({ align: "center", runs: [{ s: 0, e: 3, b: true }] });
const note = () => new Note({ noteId: "n", parts: [new NotePart({ partId: "p", partType: PartType.FRAME, frameType: "summary", text: "光合成は葉で行う", style, height: 120 })] });
const merge = (content: string) => nm.mergeSuggestions(note(), [new Suggestion({ frameType: "summary", content, targetPartId: "p" })]).parts[0];

describe("AIの提案を反映するときの書式", () => {
  it("文字が変わったら、文字ごとの書式は外す（そろえ方は残す）", () => expect(merge("呼吸はミトコンドリアで行う").style).toBe(JSON.stringify({ align: "center", runs: [] })));
  it("文字が同じなら、書式はそのまま", () => expect(merge("光合成は葉で行う").style).toBe(style));
  it("文字は提案のものになる", () => expect(merge("呼吸").text).toBe("呼吸"));
});
