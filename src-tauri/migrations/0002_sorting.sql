-- name: 0002_sorting
ALTER TABLE resources ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resources ADD COLUMN last_opened_at TEXT;
ALTER TABLE resources ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
