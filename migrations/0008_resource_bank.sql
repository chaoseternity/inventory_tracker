-- Migration 0008: Section Resource Bank for session materials (slides, handouts, etc.)

CREATE TABLE IF NOT EXISTS resources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  description  TEXT,
  section      TEXT    NOT NULL CHECK(section IN ('photo', 'video', 'av')),
  session_date TEXT,
  file_name    TEXT    NOT NULL,
  file_type    TEXT    NOT NULL DEFAULT 'application/octet-stream',
  file_size    INTEGER NOT NULL,
  r2_key       TEXT    NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resources_section ON resources(section);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources(created_at DESC);

