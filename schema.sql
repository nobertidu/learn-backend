-- runs every time the server starts. "IF NOT EXISTS" makes it safe to repeat.
CREATE TABLE IF NOT EXISTS posts (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  file_name     TEXT,
  file_original TEXT,
  file_type     TEXT,
  file_kind     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
