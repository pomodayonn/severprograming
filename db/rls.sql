-- るんです。RLS（Row-Level Security）の決まり
-- schema.sql のあとに実行する

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

-- AI利用回数：Data API からは見えない・書けない
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_usage FROM authenticated, anonymous;

-- 確認用：RLS が入っていないテーブルがあれば表示される（何も出なければOK）
SELECT tablename AS rls_missing
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;