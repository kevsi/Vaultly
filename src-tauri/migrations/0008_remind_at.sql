-- name: 0008_remind_at
-- Rappels (« me rappeler dans X jours ») : date UTC d'échéance, NULL = aucun.
-- Ouvrir la ressource solde le rappel (record_open le remet à NULL).
ALTER TABLE resources ADD COLUMN remind_at TEXT;
