-- るんです。テーブル定義（Neon / PostgreSQL）
-- 担当： 11/10）
-- 流し方：Neon の SQL Editor で、schema.sql → rls.sql の順に実行する

-- ---------- 更新日時を自動で入れる ----------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- 科目（Subject） ----------
CREATE TABLE IF NOT EXISTS subject (
  subject_id   text PRIMARY KEY,
  student_id   text NOT NULL DEFAULT auth.user_id(),
  subject_name text NOT NULL CHECK (char_length(subject_name) BETWEEN 1 AND 50),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subject_student_idx ON subject (student_id);

-- ---------- 学習項目（LearningItem） ----------
CREATE TABLE IF NOT EXISTS learning_item (
  item_id    text PRIMARY KEY,
  student_id text NOT NULL DEFAULT auth.user_id(),
  subject_id text NOT NULL REFERENCES subject (subject_id) ON DELETE CASCADE,
  item_name  text NOT NULL CHECK (char_length(item_name) BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_item_subject_idx ON learning_item (subject_id);
CREATE INDEX IF NOT EXISTS learning_item_student_idx ON learning_item (student_id);

-- ---------- 前提項目（Prerequisite） ----------
CREATE TABLE IF NOT EXISTS prerequisite (
  student_id     text NOT NULL DEFAULT auth.user_id(),
  item_id        text NOT NULL REFERENCES learning_item (item_id) ON DELETE CASCADE,
  prereq_item_id text NOT NULL REFERENCES learning_item (item_id) ON DELETE CASCADE,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, prereq_item_id),
  CHECK (item_id <> prereq_item_id)
);
CREATE INDEX IF NOT EXISTS prerequisite_student_idx ON prerequisite (student_id);

-- ---------- ノート（Note） ----------
CREATE TABLE IF NOT EXISTS note (
  note_id       text PRIMARY KEY,
  student_id    text NOT NULL DEFAULT auth.user_id(),
  item_id       text NOT NULL UNIQUE REFERENCES learning_item (item_id) ON DELETE CASCADE,
  last_saved_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_student_idx ON note (student_id);

-- ---------- ノート部品（NotePart） ----------
CREATE TABLE IF NOT EXISTS note_part (
  part_id       text PRIMARY KEY,
  student_id    text NOT NULL DEFAULT auth.user_id(),
  note_id       text NOT NULL REFERENCES note (note_id) ON DELETE CASCADE,
  part_type     text NOT NULL CHECK (part_type IN ('FRAME', 'TEXT', 'SHAPE', 'ARROW')),
  frame_type    text,
  x             integer NOT NULL DEFAULT 0,
  y             integer NOT NULL DEFAULT 0,
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  color         text,
  text          text NOT NULL DEFAULT '',
  heading_level integer NOT NULL DEFAULT 0 CHECK (heading_level BETWEEN 0 AND 3),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (part_type = 'FRAME' OR frame_type IS NULL)
);
CREATE INDEX IF NOT EXISTS note_part_note_idx ON note_part (note_id);
CREATE INDEX IF NOT EXISTS note_part_student_idx ON note_part (student_id);

-- ---------- 単語（Word） ----------
CREATE TABLE IF NOT EXISTS word (
  word_id    text PRIMARY KEY,
  student_id text NOT NULL DEFAULT auth.user_id(),
  part_id    text NOT NULL REFERENCES note_part (part_id) ON DELETE CASCADE,
  term       text NOT NULL DEFAULT '',
  meaning    text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS word_part_idx ON word (part_id);
CREATE INDEX IF NOT EXISTS word_student_idx ON word (student_id);

-- ---------- テスト（Test） ----------
CREATE TABLE IF NOT EXISTS test (
  test_id        text PRIMARY KEY,
  student_id     text NOT NULL DEFAULT auth.user_id(),
  item_id        text NOT NULL REFERENCES learning_item (item_id) ON DELETE CASCADE,
  test_type      text NOT NULL CHECK (test_type IN ('MEANING_TO_TERM', 'TERM_TO_MEANING', 'ESSAY')),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 20),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_taken_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_item_idx ON test (item_id);
CREATE INDEX IF NOT EXISTS test_student_idx ON test (student_id);

-- ---------- 問題（Question） ----------
CREATE TABLE IF NOT EXISTS question (
  question_id   text PRIMARY KEY,
  student_id    text NOT NULL DEFAULT auth.user_id(),
  test_id       text NOT NULL REFERENCES test (test_id) ON DELETE CASCADE,
  number        integer NOT NULL CHECK (number >= 1),
  question_text text NOT NULL,
  model_answer  text NOT NULL,
  explanation   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_id, number)
);
CREATE INDEX IF NOT EXISTS question_student_idx ON question (student_id);

-- ---------- 受験（Attempt） ----------
CREATE TABLE IF NOT EXISTS attempt (
  attempt_id text PRIMARY KEY,
  student_id text NOT NULL DEFAULT auth.user_id(),
  test_id    text NOT NULL REFERENCES test (test_id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  taken_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS attempt_student_idx ON attempt (student_id);

-- ---------- 解答（Answer） ----------
CREATE TABLE IF NOT EXISTS answer (
  answer_id      text PRIMARY KEY,
  student_id     text NOT NULL DEFAULT auth.user_id(),
  attempt_id     text NOT NULL REFERENCES attempt (attempt_id) ON DELETE CASCADE,
  question_id    text NOT NULL REFERENCES question (question_id) ON DELETE CASCADE,
  student_answer text NOT NULL DEFAULT '',
  correct        boolean,
  answered_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS answer_student_idx ON answer (student_id);

-- ---------- AI利用回数（AiUsage）：サーバーだけが読み書きする ----------
CREATE TABLE IF NOT EXISTS ai_usage (
  student_id text NOT NULL,
  use_date   date NOT NULL,
  count      integer NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 20),
  PRIMARY KEY (student_id, use_date)
);

-- ---------- 更新日時のトリガー（同期する10テーブル） ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subject','learning_item','prerequisite','note','note_part','word','test','question','attempt','answer'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;