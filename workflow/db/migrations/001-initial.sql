CREATE TABLE IF NOT EXISTS content_index (
  file TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'image')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  pub_date TEXT NOT NULL DEFAULT '',
  is_draft INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  content_sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS content_index_type_date
  ON content_index (content_type, pub_date DESC);

CREATE TABLE IF NOT EXISTS trash_items (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'image')),
  original_file TEXT NOT NULL,
  trash_file TEXT NOT NULL UNIQUE,
  metadata_file TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  restored_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('trashed', 'restored', 'missing')),
  content_sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trash_items_status_deleted
  ON trash_items (status, deleted_at DESC);

CREATE TABLE IF NOT EXISTS operation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS operation_history_created
  ON operation_history (created_at DESC);
