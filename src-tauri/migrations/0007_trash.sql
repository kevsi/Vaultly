-- name: 0007_trash
-- Corbeille : les ressources supprimées sont déplacées ici (30 jours) au lieu
-- de disparaître. La ligne est identifiée par son propre id (la même
-- ressource peut être supprimée/restaurée plusieurs fois). Le JSON complet
-- de la ressource (avec son id d'origine) est figé à la suppression, pour
-- pouvoir restaurer même après modification du schéma des ressources.
-- NB : pas de point-virgule dans ce fichier hors fin d'instruction (le
-- runner de migration découpe les instructions sur ce caractère).
CREATE TABLE IF NOT EXISTS deleted_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
