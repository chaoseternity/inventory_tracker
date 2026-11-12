-- Migration 0009: Add 'developer' role to users.role CHECK constraint.
-- PRAGMA foreign_keys = OFF prevents DROP TABLE users from firing ON DELETE CASCADE / SET NULL
-- on child tables referencing users(id) while rebuilding the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  google_id  TEXT,
  image      TEXT,
  role       TEXT    NOT NULL DEFAULT 'viewer' CHECK(role IN ('developer','admin','verified','viewer')),
  provider   TEXT    DEFAULT 'google',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, name, email, google_id, image, role, provider, created_at)
SELECT id, name, email, google_id, image, role, provider, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys = ON;

