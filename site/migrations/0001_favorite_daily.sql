CREATE TABLE IF NOT EXISTS favorite_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'image')),
  content_id TEXT NOT NULL,
  adds INTEGER NOT NULL DEFAULT 0 CHECK (adds >= 0),
  removes INTEGER NOT NULL DEFAULT 0 CHECK (removes >= 0),
  PRIMARY KEY (day, kind, content_id)
) WITHOUT ROWID;
