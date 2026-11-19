// db.js：Neon（PostgreSQL）につなぐ窓口
//
// 【このファイルで何が起きているか】
// .env の DATABASE_URL を読んで、SQL を送るための sql 関数を作ります。
// 使い方：await sql`SELECT * FROM ai_usage WHERE student_id = ${id}`
// ${ } に入れた値は自動でエスケープされるので、SQLインジェクションの心配はありません
// （Java の PreparedStatement の「?」と同じ役割です）
// サーバーはテーブルの持ち主の役割でつなぐので、RLS で閉じてある ai_usage も読み書きできます
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) console.warn("DATABASE_URL がないので、AIの利用回数を数えられません");

/** SQL を送る関数。DATABASE_URL がなければ null */
export const sql = url ? neon(url) : null;