-- name: 0009_indexes
-- Index pour les requêtes de la bibliothèque, jusqu'ici en scan complet :
-- accueil (folder_id IS NULL / folder_id = ?), masquage + filtre + kanban par
-- status, rappels (remind_at), tris recent/added/mostUsed (updated_at,
-- created_at, open_count). Écriture quasi nulle en comparaison des lectures.
CREATE INDEX IF NOT EXISTS idx_resources_folder ON resources(folder_id);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
CREATE INDEX IF NOT EXISTS idx_resources_remind ON resources(remind_at);
CREATE INDEX IF NOT EXISTS idx_resources_updated ON resources(updated_at);
CREATE INDEX IF NOT EXISTS idx_resources_created ON resources(created_at);
CREATE INDEX IF NOT EXISTS idx_resources_opencount ON resources(open_count);
