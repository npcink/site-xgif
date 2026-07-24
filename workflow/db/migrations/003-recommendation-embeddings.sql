CREATE TABLE IF NOT EXISTS recommendation_embeddings (
  content_id TEXT NOT NULL,
  model TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('article', 'image')),
  content_sha256 TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (content_id, model)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_embeddings_model
  ON recommendation_embeddings (model);
