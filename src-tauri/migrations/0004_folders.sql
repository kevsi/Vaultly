-- name: 0004_folders
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE resources ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
