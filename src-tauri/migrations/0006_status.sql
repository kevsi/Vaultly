-- name: 0006_status
-- statut de traitement type Pocket : '' = actif, 'todo' = à traiter, 'archived'
ALTER TABLE resources ADD COLUMN status TEXT NOT NULL DEFAULT '';
