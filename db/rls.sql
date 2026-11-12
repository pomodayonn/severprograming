-- るんです。RLS（Row-Level Security）の決まり
-- 担当：黒木（作成：東 11/10）
-- schema.sql のあとに実行する
--
-- ・ブラウザは Neon の Data API に、ログインの JWT を付けて直接読み書きする（authenticated の役割）
-- ・同期する10テーブルは「student_id = 自分の学生ID（auth.user_id()）」の行だけ読み書きできる
-- ・ai_usage は Data API から一切触れない（回数を書き換えられないように）。サーバー（Render）はテーブルの持ち主の役割で接続するので読み書きできる
-- ・テーブルを足したら、必ずここにも足す。入れ忘れたテーブルは誰でも見られてしまう

GRANT USAGE ON SCHEMA public TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subject','learning_item','prerequisite','note','note_part','word','test','question','attempt','answer'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON %I FROM anonymous', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON %I', t);
    EXECUTE format(
      'CREATE POLICY own_rows ON %I FOR ALL TO authenticated USING (student_id = auth.user_id()) WITH CHECK (student_id = auth.user_id())', t);
  END LOOP;
END $$;

-- AI利用回数：Data API（authenticated・anonymous）からは見えない・書けない
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY; -- ポリシーを作らない＝持ち主以外は1行も触れない
REVOKE ALL ON ai_usage FROM authenticated, anonymous;

-- 確認用：RLS が入っていないテーブルがあれば表示される（何も出なければOK）
SELECT tablename AS rls_missing
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;