ALTER TABLE content_index ADD COLUMN content_id TEXT NOT NULL DEFAULT '';
ALTER TABLE content_index ADD COLUMN body_excerpt TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS content_index_draft_date
  ON content_index (is_draft, pub_date DESC);
