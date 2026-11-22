// 画面の行き先とログインの型。
// 11/21 道B：前はここに画面用のデータの形（El・Note・Item・Subject・Test・MaterialMeta など）があり、
//   保存用の形（beans）と行き来するたびに変換していた。今は画面も beans（src/beans）をそのまま使うので、ここには残していない。
//   Java でいうと、Form クラスをやめて Entity クラスを画面でも使うようにした形
/** お試しログイン用に端末へ保存するアカウント（Neon Auth を使うときは使わない） */
export interface LocalAccount { id: string; email: string; pass: string; createdAt: number }
/** 枠の種類（NotePart.frameType に入る値。最終一覧が決まるまで文字列で持つ） */
export type FrameType = "word" | "problem" | "formula" | "answer" | "method" | "summary";
export type Screen = "G001" | "G002" | "G003" | "G004" | "G005" | "G006" | "G007" | "G008" | "G009" | "G010" | "G011";
/** 今どの画面か。G010 の mode：new＝解き終えた直後、retry＝解き直しの直後、list＝テスト一覧から開いた */
export interface Route {
  s: Screen; subjectId?: string; itemId?: string; materialId?: string; testId?: string;
  purpose?: "summary" | "essay"; mode?: "new" | "retry" | "list"; back?: Screen;
}
