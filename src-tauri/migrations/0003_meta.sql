-- name: 0003_meta
-- champs spécifiques au type (platform, language, status…) en JSON libre
ALTER TABLE resources ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
