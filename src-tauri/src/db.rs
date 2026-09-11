use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: i64,
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub resource_type: String,
    #[serde(default)]
    pub category: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favicon: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub open_count: i64,
    #[serde(default)]
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub position: i64,
    /// champs spécifiques au type (platform, language, status…)
    #[serde(default)]
    pub meta: std::collections::BTreeMap<String, String>,
    /// dossier (groupement) auquel appartient la ressource, si défini
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// statut de traitement : '' = actif, 'todo' = à traiter, 'archived'
    #[serde(default)]
    pub status: String,
    /// rappel « me rappeler le… » (UTC « YYYY-MM-DD HH:MM:SS »), None = aucun.
    /// Ouvrir la ressource solde le rappel (record_open le remet à NULL).
    #[serde(default)]
    pub remind_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewResource {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_resource_type")]
    pub resource_type: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favicon: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub meta: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub folder_id: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
}

fn default_resource_type() -> String {
    "site".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFilter {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub resource_type: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub limit: Option<i64>,
    /// "recent" (défaut) | "mostUsed" | "manual" | "title"
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Some(true) = sans dossier, Some(false) = ignores folder filter, None = tous
    #[serde(default)]
    pub unfiled_only: Option<bool>,
    /// filtrer sur un dossier précis
    #[serde(default)]
    pub folder_id: Option<i64>,
    /// "" = actifs, "todo" = à traiter, "archived" = archivés
    #[serde(default)]
    pub status: Option<String>,
    /// true = pas de garde-fou : `list_resources` ne plafonne pas.
    /// Quand `limit` est None et `no_limit` est false, un `LIMIT 500`
    /// protège l'UI ; les traitements internes (export, backup, vérif
    /// de liens) passent `no_limit: true` pour rester exhaustifs.
    #[serde(default)]
    pub no_limit: bool,
    /// true = exclure les archivés (`status != 'archived'`). Utilisé par
    /// l'accueil pour masquer le « fait » sans le retirer par dossier ;
    /// ignoré si un filtre `status` explicite est déjà posé.
    #[serde(default)]
    pub hide_archived: bool,
}

/// Échappe les jokers LIKE (% _ et l'échappement lui-même) pour que la
/// recherche soit littérale : chercher « 100% » ne matche plus « 1000 ».
fn escape_like(s: &str) -> String {
    const ESC: char = '\\';
    let e = ESC.to_string();
    s.replace(ESC, &e.repeat(2))
        .replace('%', &format!("{e}%"))
        .replace('_', &format!("{e}_"))
}

fn row_to_resource(row: sqlx::sqlite::SqliteRow) -> Resource {
    let tags_json: String = row.try_get("tags").unwrap_or_else(|_| "[]".into());
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let meta_json: String = row.try_get("meta").unwrap_or_else(|_| "{}".into());
    let meta: std::collections::BTreeMap<String, String> =
        serde_json::from_str(&meta_json).unwrap_or_default();
    Resource {
        id: row.get("id"),
        url: row.get("url"),
        title: row.get("title"),
        description: row.get("description"),
        resource_type: row.get("resource_type"),
        category: row.get("category"),
        tags,
        notes: row.get("notes"),
        favicon: row.get("favicon"),
        favorite: row.get::<i64, _>("favorite") != 0,
        open_count: row.get("open_count"),
        last_opened_at: row.get("last_opened_at"),
        position: row.get("position"),
        meta,
        folder_id: row.get("folder_id"),
        status: row.get("status"),
        remind_at: row.get("remind_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn open_pool(db_path: &std::path::Path) -> Result<SqlitePool, sqlx::Error> {
    // SQLite a besoin de slashes ; create_if_missing évite l'erreur 14 au premier lancement
    let path_str = db_path.to_string_lossy().replace('\\', "/");
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{path_str}"))
        .map_err(|e| sqlx::Error::Configuration(Box::new(e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        // les clés étrangères doivent être activées PAR CONNEXION : un
        // `PRAGMA foreign_keys=ON` exécuté via le pool ne toucherait que
        // la première connexion ouverte, les autres resteraient sans FK.
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(opts)
        .await?;
    Ok(pool)
}

/// true si `PRAGMA integrity_check` rend « ok » (base saine).
pub async fn integrity_ok(pool: &SqlitePool) -> bool {
    sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_one(pool)
        .await
        .map(|s| s == "ok")
        .unwrap_or(false)
}

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
    )
    .execute(pool)
    .await?;

    for (name, sql) in [
        ("0001_init", include_str!("../migrations/0001_init.sql")),
        ("0002_sorting", include_str!("../migrations/0002_sorting.sql")),
        ("0003_meta", include_str!("../migrations/0003_meta.sql")),
        ("0004_folders", include_str!("../migrations/0004_folders.sql")),
        ("0005_nested_folders", include_str!("../migrations/0005_nested_folders.sql")),
        ("0006_status", include_str!("../migrations/0006_status.sql")),
        ("0007_trash", include_str!("../migrations/0007_trash.sql")),
        ("0008_remind_at", include_str!("../migrations/0008_remind_at.sql")),
        ("0009_indexes", include_str!("../migrations/0009_indexes.sql")),
    ] {
        // chaque migration est exécutée dans une transaction
        let mut tx = pool.begin().await?;
        // le nom est fourni ICI (pas extrait du SQL) : une migration oubliant
        // son marqueur `-- name:` ne peut plus être enregistrée sous une clé
        // partagée « unnamed » — piège qui ferait ignorer silencieusement
        // toute future migration mal étiquetée.
        let already: Option<String> =
            sqlx::query_scalar("SELECT name FROM _migrations WHERE name = ?")
                .bind(name)
                .fetch_optional(&mut *tx)
                .await?;
        if already.is_none() {
            // NB : le découpage sur ';' suppose qu'aucune migration ne contient
            // de point-virgule à l'intérieur d'une chaîne ou d'un trigger.
            for stmt in sql.split(';') {
                // retire les lignes de commentaire avant d'exécuter le bloc
                let body: String = stmt
                    .lines()
                    .filter(|l| !l.trim_start().starts_with("--"))
                    .collect::<Vec<_>>()
                    .join("\n");
                let stmt = body.trim();
                if !stmt.is_empty() {
                    if let Err(e) = sqlx::query(stmt).execute(&mut *tx).await {
                        // base pré-existante créée avant la table _migrations :
                        // les tables/colonnes peuvent déjà être là. On tolère
                        // « already exists » / « duplicate column » et on marque
                        // la migration comme appliquée ; toute autre erreur
                        // reste bloquante.
                        let msg = e.to_string().to_lowercase();
                        if !msg.contains("already exists")
                            && !msg.contains("duplicate column name")
                        {
                            return Err(e);
                        }
                    }
                }
            }
            sqlx::query("INSERT INTO _migrations (name) VALUES (?)")
                .bind(name)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
    }
    Ok(())
}

pub async fn list_resources(
    pool: &SqlitePool,
    filter: &ResourceFilter,
) -> Result<Vec<Resource>, String> {
    let mut clauses: Vec<String> = Vec::new();
    let mut q = String::from(
        "SELECT id, url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at FROM resources",
    );

    if !filter.query.trim().is_empty() {
        clauses.push(
            "(title COLLATE NOCASE LIKE ? ESCAPE '\\' OR url COLLATE NOCASE LIKE ? ESCAPE '\\' OR description COLLATE NOCASE LIKE ? ESCAPE '\\' OR notes COLLATE NOCASE LIKE ? ESCAPE '\\' OR tags COLLATE NOCASE LIKE ? ESCAPE '\\')"
                .into(),
        );
    }
    if let Some(t) = &filter.resource_type {
        if !t.is_empty() {
            clauses.push("resource_type = ?".into());
        }
    }
    if let Some(c) = &filter.category {
        if !c.is_empty() {
            clauses.push("category = ? COLLATE NOCASE".into());
        }
    }
    if let Some(tag) = &filter.tag {
        if !tag.is_empty() {
            clauses.push("tags LIKE ? ESCAPE '\\'".into());
        }
    }
    match filter.favorite {
        Some(true) => clauses.push("favorite = 1".into()),
        Some(false) => clauses.push("favorite = 0".into()),
        None => {}
    }
    let mut status_clause = false;
    if filter.status.is_some() {
        // Some("") = actifs, Some("todo") / Some("archived")
        clauses.push("status = ?".into());
        status_clause = true;
    }
    // accueil : masquer les archivés sans filtre status explicite
    if filter.hide_archived && !status_clause {
        clauses.push("status != 'archived'".into());
    }
    if filter.folder_id.is_some() {
        clauses.push("folder_id = ?".into());
    }
    if let Some(true) = filter.unfiled_only {
        clauses.push("folder_id IS NULL".into());
    }

    if !clauses.is_empty() {
        q.push_str(" WHERE ");
        q.push_str(&clauses.join(" AND "));
    }
    match filter.sort_by.as_deref() {
        Some("mostUsed") => {
            q.push_str(" ORDER BY open_count DESC, last_opened_at DESC, favorite DESC, title COLLATE NOCASE ASC");
        }
        Some("manual") => {
            q.push_str(" ORDER BY position ASC, favorite DESC, title COLLATE NOCASE ASC");
        }
        Some("title") => {
            q.push_str(" ORDER BY title COLLATE NOCASE ASC");
        }
        Some("added") => {
            q.push_str(" ORDER BY created_at DESC, id DESC");
        }
        Some("oldest") => {
            q.push_str(" ORDER BY created_at ASC, id ASC");
        }
        // défaut : "recent"
        _ => {
            q.push_str(" ORDER BY favorite DESC, updated_at DESC");
        }
    }
    let limit_value = match filter.limit {
        Some(limit) => Some(limit.max(1)),
        // garde-fou UI : sans demande explicite, on plafonne à 500 lignes.
        None if !filter.no_limit => Some(500),
        None => None,
    };
    if limit_value.is_some() {
        q.push_str(" LIMIT ?");
    }

    let mut query = sqlx::query(&q);
    if !filter.query.trim().is_empty() {
        let like = format!("%{}%", escape_like(filter.query.trim()));
        for _ in 0..5 {
            query = query.bind(like.clone());
        }
    }
    if let Some(t) = &filter.resource_type {
        if !t.is_empty() {
            query = query.bind(t);
        }
    }
    if let Some(c) = &filter.category {
        if !c.is_empty() {
            query = query.bind(c);
        }
    }
    if let Some(tag) = &filter.tag {
        if !tag.is_empty() {
            // JSON array : cible le tag exact entre guillemets
            query = query.bind(format!("%\"{}\"%", escape_like(tag)));
        }
    }
    if status_clause {
        if let Some(s) = &filter.status {
            query = query.bind(s);
        }
    }
    if let Some(id) = filter.folder_id {
        query = query.bind(id);
    }
    if let Some(limit) = limit_value {
        query = query.bind(limit);
    }

    let rows = query.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_resource).collect())
}

pub async fn get_resource(pool: &SqlitePool, id: i64) -> Result<Resource, String> {
    let row = sqlx::query(
        "SELECT id, url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at FROM resources WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("ressource {id} introuvable"))?;
    Ok(row_to_resource(row))
}

/// Variante transactionnelle de `get_resource` (import/restauration).
pub(crate) async fn get_resource_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: i64,
) -> Result<Resource, String> {
    let row = sqlx::query(
        "SELECT id, url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at FROM resources WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("ressource {id} introuvable"))?;
    Ok(row_to_resource(row))
}

/// Vrai si l'erreur sqlx est une violation de contrainte UNIQUE — arrive si
/// un ajout concurrent passe le contrôle de doublon (SELECT puis INSERT non
/// atomiques) : on renvoie le même message que le contrôle préalable.
fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.to_string().to_lowercase().contains("unique constraint")
}

pub async fn add_resource(
    pool: &SqlitePool,
    new: &NewResource,
) -> Result<Resource, String> {
    let tags = serde_json::to_string(&new.tags).map_err(|e| e.to_string())?;
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM resources WHERE url = ? COLLATE NOCASE")
        .bind(&new.url)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Err(format!("URL déjà enregistrée (ressource {id})"));
    }

    let meta = serde_json::to_string(&new.meta).map_err(|e| e.to_string())?;
    let result = sqlx::query(
        // position auto : après tout le monde, pour que les nouvelles
        // ressources ne s'intercalent pas en tête du tri manuel
        "INSERT INTO resources (url, title, description, resource_type, category, tags, notes, favicon, favorite, meta, folder_id, status, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM resources))",
    )
    .bind(&new.url)
    .bind(&new.title)
    .bind(&new.description)
    .bind(&new.resource_type)
    .bind(&new.category)
    .bind(&tags)
    .bind(&new.notes)
    .bind(&new.favicon)
    .bind(new.favorite as i64)
    .bind(&meta)
    .bind(new.folder_id)
    .bind(new.status.clone().unwrap_or_default())
    .execute(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            "URL déjà enregistrée (ajout concurrent)".to_string()
        } else {
            e.to_string()
        }
    })?;

    get_resource(pool, result.last_insert_rowid()).await
}

/// Variante transactionnelle de `add_resource` : mêmes contrôles
/// (doublon d'URL), mêmes messages, mais tout passe par `tx` pour que
/// l'appelant puisse annuler l'ensemble en cas d'erreur à mi-parcours.
pub(crate) async fn add_resource_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    new: &NewResource,
) -> Result<Resource, String> {
    let tags = serde_json::to_string(&new.tags).map_err(|e| e.to_string())?;
    let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM resources WHERE url = ? COLLATE NOCASE")
        .bind(&new.url)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Err(format!("URL déjà enregistrée (ressource {id})"));
    }

    let meta = serde_json::to_string(&new.meta).map_err(|e| e.to_string())?;
    let result = sqlx::query(
        // position auto : après tout le monde (voir add_resource)
        "INSERT INTO resources (url, title, description, resource_type, category, tags, notes, favicon, favorite, meta, folder_id, status, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM resources))",
    )
    .bind(&new.url)
    .bind(&new.title)
    .bind(&new.description)
    .bind(&new.resource_type)
    .bind(&new.category)
    .bind(&tags)
    .bind(&new.notes)
    .bind(&new.favicon)
    .bind(new.favorite as i64)
    .bind(&meta)
    .bind(new.folder_id)
    .bind(new.status.clone().unwrap_or_default())
    .execute(&mut **tx)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            "URL déjà enregistrée (ajout concurrent)".to_string()
        } else {
            e.to_string()
        }
    })?;

    get_resource_tx(tx, result.last_insert_rowid()).await
}

pub async fn update_resource(
    pool: &SqlitePool,
    id: i64,
    new: &NewResource,
) -> Result<Resource, String> {
    let tags = serde_json::to_string(&new.tags).map_err(|e| e.to_string())?;
    let meta = serde_json::to_string(&new.meta).map_err(|e| e.to_string())?;
    let updated = sqlx::query(
        "UPDATE resources SET url = ?, title = ?, description = ?, resource_type = ?, category = ?, tags = ?, notes = ?, favicon = ?, favorite = ?, meta = ?, folder_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&new.url)
    .bind(&new.title)
    .bind(&new.description)
    .bind(&new.resource_type)
    .bind(&new.category)
    .bind(&tags)
    .bind(&new.notes)
    .bind(&new.favicon)
    .bind(new.favorite as i64)
    .bind(&meta)
    .bind(new.folder_id)
    .bind(new.status.clone().unwrap_or_default())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            "URL déjà enregistrée sur une autre ressource".to_string()
        } else {
            e.to_string()
        }
    })?;
    if updated.rows_affected() == 0 {
        return Err(format!("ressource {id} introuvable"));
    }
    get_resource(pool, id).await
}

pub async fn delete_resource(pool: &SqlitePool, id: i64) -> Result<(), String> {
    // déplacement dans la corbeille (30 jours) plutôt que disparition :
    // SELECT + INSERT + DELETE dans une transaction pour qu'une ressource
    // ne puisse jamais se retrouver à la fois absente de resources ET
    // absente de deleted_resources.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let res = get_resource_tx(&mut tx, id).await?;
    let json = serde_json::to_string(&res).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO deleted_resources (resource) VALUES (?)")
        .bind(&json)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let updated = sqlx::query("DELETE FROM resources WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 {
        return Err(format!("ressource {id} introuvable"));
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Supprime plusieurs ressources en une transaction (via la corbeille).
/// Retourne le nombre supprimé.
pub async fn delete_resources(
    pool: &SqlitePool,
    ids: &[i64],
) -> Result<usize, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut n = 0;
    for id in ids {
        // le GET doit survivre à un id inconnu (bulk concurrent) : on saute
        let existing: Option<i64> = sqlx::query_scalar("SELECT id FROM resources WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if existing.is_none() {
            continue;
        }
        let res = get_resource_tx(&mut tx, *id).await?;
        let json = serde_json::to_string(&res).map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO deleted_resources (resource) VALUES (?)")
            .bind(&json)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        let r = sqlx::query("DELETE FROM resources WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        n += r.rows_affected();
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(n as usize)
}

/// Une ligne de la corbeille : la ressource figée + sa date de suppression.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub trash_id: i64,
    pub resource: Resource,
    pub deleted_at: String,
}

pub async fn list_trash(pool: &SqlitePool) -> Result<Vec<TrashEntry>, String> {
    let rows: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT id, resource, deleted_at FROM deleted_resources ORDER BY deleted_at DESC, id DESC LIMIT 500",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(|(id, resource, deleted_at)| {
            serde_json::from_str::<Resource>(&resource)
                .ok()
                .map(|r| TrashEntry {
                    trash_id: id,
                    resource: r,
                    deleted_at,
                })
        })
        .collect())
}

/// Restaure une ligne de la corbeille dans resources. L'URL doit être libre
/// (sinon « déjà enregistrée ») ; le dossier d'origine n'est conservé que
/// s'il existe encore ; l'id est réattribué (l'ancien a pu être repris).
pub async fn restore_trash(pool: &SqlitePool, trash_id: i64) -> Result<Resource, String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT resource FROM deleted_resources WHERE id = ?")
            .bind(trash_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let (json,) = row.ok_or(format!("entrée de corbeille {trash_id} introuvable"))?;
    let res: Resource =
        serde_json::from_str(&json).map_err(|e| format!("corbeille illisible : {e}"))?;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let dup: Option<i64> =
        sqlx::query_scalar("SELECT id FROM resources WHERE url = ? COLLATE NOCASE")
            .bind(&res.url)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    if let Some(existing) = dup {
        return Err(format!("URL déjà enregistrée (ressource {existing})"));
    }
    // le dossier d'origine a peut-être été supprimé entre-temps
    let folder_ok: Option<i64> = match res.folder_id {
        Some(fid) => {
            sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
                .bind(fid)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?
        }
        None => Some(0),
    };
    let folder_id = if folder_ok.is_some() { res.folder_id } else { None };
    let tags = serde_json::to_string(&res.tags).map_err(|e| e.to_string())?;
    let meta = serde_json::to_string(&res.meta).map_err(|e| e.to_string())?;
    let inserted = sqlx::query(
        "INSERT INTO resources (url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&res.url)
    .bind(&res.title)
    .bind(&res.description)
    .bind(&res.resource_type)
    .bind(&res.category)
    .bind(&tags)
    .bind(&res.notes)
    .bind(&res.favicon)
    .bind(res.favorite as i64)
    .bind(res.open_count)
    .bind(&res.last_opened_at)
    .bind(res.position)
    .bind(&meta)
    .bind(folder_id)
    .bind(&res.status)
    .bind(&res.remind_at)
    .bind(&res.created_at)
    .bind(&res.updated_at)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        if is_unique_violation(&e) {
            "URL déjà enregistrée (ajout concurrent)".to_string()
        } else {
            e.to_string()
        }
    })?;
    sqlx::query("DELETE FROM deleted_resources WHERE id = ?")
        .bind(trash_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    get_resource(pool, inserted.last_insert_rowid()).await
}

/// Vide la corbeille. Retourne le nombre d'entrées supprimées.
pub async fn empty_trash(pool: &SqlitePool) -> Result<usize, String> {
    let r = sqlx::query("DELETE FROM deleted_resources")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(r.rows_affected() as usize)
}

/// Restaure plusieurs entrées de la corbeille EN UNE TRANSACTION (tout ou
/// rien : si une URL est déjà enregistrée, rien n'est restauré et l'erreur
/// nomme la ressource fautive). Le retour liste les ids de corbeille
/// introuvables entre-temps (restaurés dans un autre onglet…) — sans échouer.
pub async fn restore_trash_bulk(
    pool: &SqlitePool,
    trash_ids: &[i64],
) -> Result<Vec<i64>, String> {
    if trash_ids.is_empty() {
        return Ok(vec![]);
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut missing: Vec<i64> = Vec::new();
    for &trash_id in trash_ids {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT resource FROM deleted_resources WHERE id = ?")
                .bind(trash_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        let Some((json,)) = row else {
            missing.push(trash_id);
            continue;
        };
        let res: Resource =
            serde_json::from_str(&json).map_err(|e| format!("corbeille illisible : {e}"))?;

        // même logique que restore_trash : URL libre exigée, dossier
        // d'origine conservé seulement s'il existe encore
        let dup: Option<i64> =
            sqlx::query_scalar("SELECT id FROM resources WHERE url = ? COLLATE NOCASE")
                .bind(&res.url)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if let Some(existing) = dup {
            tx.rollback().await.ok();
            return Err(format!(
                "« {} » : URL déjà enregistrée (ressource {existing}) — rien n'a été restauré",
                res.title
            ));
        }
        let folder_ok: Option<i64> = match res.folder_id {
            Some(fid) => {
                sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
                    .bind(fid)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?
            }
            None => Some(0),
        };
        let folder_id = if folder_ok.is_some() { res.folder_id } else { None };
        let tags = serde_json::to_string(&res.tags).map_err(|e| e.to_string())?;
        let meta = serde_json::to_string(&res.meta).map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO resources (url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&res.url)
        .bind(&res.title)
        .bind(&res.description)
        .bind(&res.resource_type)
        .bind(&res.category)
        .bind(&tags)
        .bind(&res.notes)
        .bind(&res.favicon)
        .bind(res.favorite as i64)
        .bind(res.open_count)
        .bind(&res.last_opened_at)
        .bind(res.position)
        .bind(&meta)
        .bind(folder_id)
        .bind(&res.status)
        .bind(&res.remind_at)
        .bind(&res.created_at)
        .bind(&res.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            if is_unique_violation(&e) {
                "URL déjà enregistrée (ajout concurrent)".to_string()
            } else {
                e.to_string()
            }
        })?;
        sqlx::query("DELETE FROM deleted_resources WHERE id = ?")
            .bind(trash_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(missing)
}

/// Supprime les entrées de plus de `days` jours. Appelé au démarrage.
pub async fn purge_expired_trash(pool: &SqlitePool, days: i64) -> Result<usize, String> {
    let r = sqlx::query("DELETE FROM deleted_resources WHERE deleted_at < datetime('now', ?)")
        .bind(format!("-{days} days"))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(r.rows_affected() as usize)
}

pub async fn toggle_favorite(pool: &SqlitePool, id: i64) -> Result<Resource, String> {
    sqlx::query("UPDATE resources SET favorite = 1 - favorite, updated_at = datetime('now') WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    get_resource(pool, id).await
}

/// Incrémente le compteur d'ouvertures, date la dernière ouverture et solde
/// un éventuel rappel (ouvrir = traité).
pub async fn record_open(pool: &SqlitePool, id: i64) -> Result<(), String> {
    sqlx::query(
        "UPDATE resources SET open_count = open_count + 1, last_opened_at = datetime('now'), remind_at = NULL WHERE id = ?",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Pose (ou efface avec None) un rappel « me rappeler le… » (UTC
/// « YYYY-MM-DD HH:MM:SS »).
pub async fn set_remind_at(
    pool: &SqlitePool,
    id: i64,
    remind_at: Option<String>,
) -> Result<(), String> {
    if let Some(ref at) = remind_at {
        // garde de format : on ne stocke que du datetime SQLite triable
        if at.len() != 19 || at.as_bytes().get(10) != Some(&b' ') {
            return Err("date de rappel invalide (AAAA-MM-JJ HH:MM:SS)".into());
        }
    }
    sqlx::query("UPDATE resources SET remind_at = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(remind_at)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Rappels échus (non archivés), les plus urgents d'abord.
pub async fn due_reminders(pool: &SqlitePool, limit: i64) -> Result<Vec<Resource>, String> {
    let rows = sqlx::query(
        "SELECT id, url, title, description, resource_type, category, tags, notes, favicon, favorite, open_count, last_opened_at, position, meta, folder_id, status, remind_at, created_at, updated_at FROM resources WHERE remind_at IS NOT NULL AND remind_at <= datetime('now') AND status != 'archived' ORDER BY remind_at ASC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_resource).collect())
}

/// Réordonnancement PARTIEL du placement manuel : seules les ids de la liste
/// changent de position. Elles se répartissent les positions qu'elles
/// occupaient déjà (triées croissantes), redistribuées dans l'ordre demandé ;
/// les ressources absentes de la liste (vue filtrée, plafonnée à 500, ou
/// contenu d'un dossier) ne sont PAS touchées. Un drag dans une recherche ne
/// réécrit donc plus l'ordre manuel de toute la bibliothèque.
/// Repli : si les ids listées occupent des positions dupliquées (cas d'une
/// bibliothèque restaurée où tout est à 0), on normalise globalement à
/// l'ancienne — sinon l'échange de slots identiques serait un no-op.
pub async fn reorder_resources(
    pool: &SqlitePool,
    ordered_ids: &[i64],
) -> Result<(), String> {
    if ordered_ids.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // ids connues, dans l'ordre demandé (dédoublonnées) + leurs positions actuelles
    let placeholders = vec!["?"; ordered_ids.len()].join(",");
    let select = format!("SELECT id, position FROM resources WHERE id IN ({placeholders})");
    let mut q = sqlx::query_as::<_, (i64, i64)>(&select);
    for id in ordered_ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let known: std::collections::HashMap<i64, i64> = rows.into_iter().collect();
    let mut seen = std::collections::HashSet::new();
    let targets: Vec<i64> = ordered_ids
        .iter()
        .copied()
        .filter(|id| seen.insert(*id) && known.contains_key(id))
        .collect();
    if targets.is_empty() {
        return Ok(());
    }
    let mut slots: Vec<i64> = targets.iter().filter_map(|id| known.get(id).copied()).collect();
    slots.sort();
    let dups = {
        let mut s = slots.clone();
        s.dedup();
        s.len() != slots.len()
    };
    if dups {
        // normalisation globale (ancien comportement) : la liste prend 0..n,
        // tout le reste est décalé hors de la plage (position = base + id).
        let base = targets.len() as i64 + 1;
        sqlx::query("UPDATE resources SET position = ? + id")
            .bind(base)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        for (i, id) in targets.iter().enumerate() {
            sqlx::query("UPDATE resources SET position = ? WHERE id = ?")
                .bind(i as i64)
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    } else {
        for (id, pos) in targets.iter().zip(slots.iter()) {
            sqlx::query("UPDATE resources SET position = ? WHERE id = ?")
                .bind(*pos)
                .bind(*id)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn all_tags(pool: &SqlitePool) -> Result<Vec<String>, String> {
    let rows: Vec<String> = sqlx::query_scalar("SELECT tags FROM resources")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut tags: Vec<String> = rows
        .iter()
        .filter_map(|r| serde_json::from_str::<Vec<String>>(r).ok())
        .flatten()
        .collect();
    tags.sort();
    tags.dedup();
    Ok(tags)
}

/// Renomme un tag partout ; fusion si `new` existe déjà (les doublons
/// intra-ressource sont éliminés). Retourne les ressources touchées.
pub async fn rename_tag(pool: &SqlitePool, old: &str, new: &str) -> Result<usize, String> {
    let old = old.trim();
    let new = new.trim();
    if old.is_empty() || new.is_empty() {
        return Err("tag vide".into());
    }
    if old == new {
        return Ok(0);
    }
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, tags FROM resources")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut touched = 0usize;
    for (id, tags_json) in rows {
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        if !tags.iter().any(|t| t == old) {
            continue;
        }
        let mut next: Vec<String> = tags
            .into_iter()
            .map(|t| if t == old { new.to_string() } else { t })
            .collect();
        next.sort();
        next.dedup();
        let json = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        sqlx::query("UPDATE resources SET tags = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&json)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        touched += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(touched)
}

/// Supprime un tag de toutes les ressources. Retourne les touchées.
pub async fn remove_tag(pool: &SqlitePool, tag: &str) -> Result<usize, String> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Err("tag vide".into());
    }
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, tags FROM resources")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut touched = 0usize;
    for (id, tags_json) in rows {
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        if !tags.iter().any(|t| t == tag) {
            continue;
        }
        let next: Vec<String> = tags.into_iter().filter(|t| t != tag).collect();
        let json = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        sqlx::query("UPDATE resources SET tags = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&json)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        touched += 1;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(touched)
}

/// Tags + compteurs, triés insensible à la casse.
pub async fn tag_stats(pool: &SqlitePool) -> Result<Vec<(String, i64)>, String> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT value AS tag, COUNT(*) AS n FROM resources, json_each(resources.tags) GROUP BY value ORDER BY value COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows)
}

// --- Dossiers (groupements de ressources) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub icon: String,
    /// dossier parent (imbrication), None = racine
    #[serde(default)]
    pub parent_id: Option<i64>,
    /// ressources jamais ouvertes dedans (badge nouveautés)
    #[serde(default)]
    pub unseen: i64,
    #[serde(default)]
    pub position: i64,
    /// nombre de ressources dedans (pour la tuile)
    #[serde(default)]
    pub count: i64,
    /// jusqu'à 4 favicons pour la pile visuelle de la tuile
    #[serde(default)]
    pub preview_icons: Vec<String>,
}

/// Ligne agrégée de `list_folders` : (id, nom, icône, parent, position,
/// nombre de ressources, jamais ouvertes).
type FolderRow = (i64, String, String, Option<i64>, i64, i64, i64);

pub async fn list_folders(pool: &SqlitePool) -> Result<Vec<Folder>, String> {
    let rows: Vec<FolderRow> = sqlx::query_as(
        "SELECT f.id, f.name, f.icon, f.parent_id, f.position, COUNT(r.id), \
                COALESCE(SUM(CASE WHEN r.open_count = 0 THEN 1 ELSE 0 END), 0) \
         FROM folders f LEFT JOIN resources r ON r.folder_id = f.id \
         GROUP BY f.id ORDER BY f.position ASC, f.id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // UNE seule requête pour les aperçus : les favicons non vides de tous
    // les dossiers, triés par position ; on garde les 4 premiers par dossier
    // côté Rust (comportement identique à l'ancienne requête-par-dossier).
    let all_favicons: Vec<(Option<i64>, String)> = sqlx::query_as(
        "SELECT folder_id, favicon FROM resources WHERE folder_id IS NOT NULL AND favicon != '' ORDER BY position ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut favicons_by_folder: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    for (folder_id, favicon) in all_favicons {
        if let Some(fid) = folder_id {
            let entry = favicons_by_folder.entry(fid).or_default();
            if entry.len() < 4 {
                entry.push(favicon);
            }
        }
    }

    let mut out = Vec::new();
    for (id, name, icon, parent_id, position, count, unseen) in rows {
        // jusqu'à 4 icônes des ressources du dossier pour l'aperçu
        let favicons = favicons_by_folder.remove(&id).unwrap_or_default();
        out.push(Folder {
            id,
            name,
            icon,
            parent_id,
            unseen,
            position,
            count,
            preview_icons: favicons,
        });
    }
    Ok(out)
}

pub async fn create_folder(
    pool: &SqlitePool,
    name: &str,
    icon: &str,
    parent_id: Option<i64>,
) -> Result<Folder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("le nom du dossier est obligatoire".into());
    }
    if let Some(pid) = parent_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
            .bind(pid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("dossier parent {pid} introuvable"));
        }
    }
    let result = sqlx::query("INSERT INTO folders (name, icon, parent_id) VALUES (?, ?, ?)")
        .bind(name)
        .bind(icon)
        .bind(parent_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Folder {
        id: result.last_insert_rowid(),
        name: name.to_string(),
        icon: icon.to_string(),
        parent_id,
        unseen: 0,
        position: 0,
        count: 0,
        preview_icons: vec![],
    })
}

/// Variante transactionnelle de `create_folder` : mêmes contrôles,
/// mêmes messages, insertion via `tx`.
pub(crate) async fn create_folder_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    name: &str,
    icon: &str,
    parent_id: Option<i64>,
) -> Result<Folder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("le nom du dossier est obligatoire".into());
    }
    if let Some(pid) = parent_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
            .bind(pid)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("dossier parent {pid} introuvable"));
        }
    }
    let result = sqlx::query("INSERT INTO folders (name, icon, parent_id) VALUES (?, ?, ?)")
        .bind(name)
        .bind(icon)
        .bind(parent_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(Folder {
        id: result.last_insert_rowid(),
        name: name.to_string(),
        icon: icon.to_string(),
        parent_id,
        unseen: 0,
        position: 0,
        count: 0,
        preview_icons: vec![],
    })
}



pub async fn rename_folder(
    pool: &SqlitePool,
    id: i64,
    name: &str,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("le nom du dossier est obligatoire".into());
    }
    let updated = sqlx::query("UPDATE folders SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 {
        return Err(format!("dossier {id} introuvable"));
    }
    Ok(())
}

/// Nettoyage one-shot des dossiers-système hérités (« À traiter », « Archivés »)
/// créés par l'ancien modèle où `status` se doublait d'un rang en dossier. La
/// source de vérité est désormais le seul champ `status` : on supprime ces
/// dossiers racine homonymes, et grace à `ON DELETE SET NULL` leurs ressources
/// ressortent à la racine EN GARDANT leur statut (rien n'est perdu, archivés
/// restent masqués de l'accueil par `hide_archived`).
///
/// Un dossier de ce nom possédant des sous-dossiers est considéré détourné par
/// l'utilisateur et LAISSÉ INTACT. Retourne le nombre de dossiers supprimés.
pub async fn cleanup_legacy_status_folders(pool: &SqlitePool) -> Result<usize, String> {
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, name FROM folders WHERE parent_id IS NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let legacy = |n: &str| {
        let l = n.trim().to_lowercase();
        l == "à traiter" || l == "archivés"
    };
    let mut removed = 0usize;
    for (id, name) in rows {
        if !legacy(&name) {
            continue;
        }
        let children: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM folders WHERE parent_id = ?")
                .bind(id)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
        if children > 0 {
            continue; // dossier réutilisé par l'utilisateur : on n'y touche pas
        }
        let r = sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        if r.rows_affected() > 0 {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Supprime un dossier RÉCURSIVEMENT : toutes les ressources du dossier et
/// de ses sous-dossiers (à tous les niveaux) partent à la corbeille
/// (restaurables 30 jours), puis le dossier est supprimé — le
/// ON DELETE CASCADE de parent_id (0005) emporte les sous-dossiers, sûr
/// désormais que leurs ressources sont déjà à la corbeille.
/// Retourne le nombre de ressources mises à la corbeille.
pub async fn delete_folder(pool: &SqlitePool, id: i64) -> Result<usize, String> {
    // 1) ids du dossier + tous ses descendants (par vagues de parents ; la
    //    garde anti-cycle de move_folder empêche les boucles, le `seen`
    //    protège en plus)
    let mut all: Vec<i64> = vec![id];
    let mut frontier: Vec<i64> = vec![id];
    while !frontier.is_empty() {
        let placeholders = frontier.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id FROM folders WHERE parent_id IN ({placeholders})");
        let mut q = sqlx::query_scalar::<_, i64>(&sql);
        for fid in &frontier {
            q = q.bind(fid);
        }
        let children = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
        frontier.clear();
        for c in children {
            if !all.contains(&c) {
                all.push(c);
                frontier.push(c);
            }
        }
    }

    // 2) toutes les ressources de ces dossiers → corbeille
    let placeholders = all.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id FROM resources WHERE folder_id IN ({placeholders})");
    let mut q = sqlx::query_scalar::<_, i64>(&sql);
    for fid in &all {
        q = q.bind(fid);
    }
    let res_ids = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    let trashed = if res_ids.is_empty() {
        0
    } else {
        delete_resources(pool, &res_ids).await?
    };

    // 3) le dossier (+ sous-dossiers via CASCADE) dans UNE transaction
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let updated = sqlx::query("DELETE FROM folders WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 {
        return Err(format!("dossier {id} introuvable"));
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(trashed)
}

/// Déplace un dossier dans un autre (new_parent_id = None → racine).
/// Refuse les cycles : on ne peut pas mettre un dossier dans l'un de ses
/// propres descendants.
pub async fn move_folder(
    pool: &SqlitePool,
    folder_id: i64,
    new_parent_id: Option<i64>,
) -> Result<(), String> {
    if folder_id == new_parent_id.unwrap_or(i64::MIN) {
        return Err("un dossier ne peut pas se contenir lui-même".into());
    }
    if let Some(pid) = new_parent_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
            .bind(pid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("dossier parent {pid} introuvable"));
        }
        // remonter la chaîne des parents : si on recroise folder_id → cycle
        let mut cur = Some(pid);
        let mut guard = 0;
        while let Some(c) = cur {
            if c == folder_id {
                return Err("impossible : déplacement circulaire".into());
            }
            guard += 1;
            if guard > 100 {
                break; // sécurité anti-boucle infinie
            }
            cur = sqlx::query_scalar("SELECT parent_id FROM folders WHERE id = ?")
                .bind(c)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    let updated = sqlx::query("UPDATE folders SET parent_id = ? WHERE id = ?")
        .bind(new_parent_id)
        .bind(folder_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 {
        return Err(format!("dossier {folder_id} introuvable"));
    }
    Ok(())
}

/// Dissout un dossier : ses ressources sont relâchées dans la grille et ses
/// sous-dossiers remontent d'un niveau. Rien n'est supprimé à part le dossier.
pub async fn dissolve_folder(pool: &SqlitePool, id: i64) -> Result<(), String> {
    // parent_id est NULL pour un dossier racine : le scalaire doit être
    // typé Option<i64>, sinon sqlx échoue à décoder NULL en i64 et la
    // dissolution plantait sur tous les dossiers racine.
    let row: Option<(Option<i64>,)> = sqlx::query_as("SELECT parent_id FROM folders WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let parent_id = row
        .ok_or_else(|| format!("dossier {id} introuvable"))?
        .0;

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // 1) les ressources du dossier retournent dans la grille
    sqlx::query("UPDATE resources SET folder_id = NULL WHERE folder_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    // 2) les sous-dossiers remontent au niveau du dossier dissous
    sqlx::query("UPDATE folders SET parent_id = ? WHERE parent_id = ?")
        .bind(parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    // 3) on retire le dossier vide
    sqlx::query("DELETE FROM folders WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Range une ressource dans un dossier (folder_id = None pour la sortir).
pub async fn set_resource_folder(
    pool: &SqlitePool,
    resource_id: i64,
    folder_id: Option<i64>,
) -> Result<(), String> {
    if let Some(fid) = folder_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM folders WHERE id = ?")
            .bind(fid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("dossier {fid} introuvable"));
        }
    }
    sqlx::query("UPDATE resources SET folder_id = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(folder_id)
        .bind(resource_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Settings ---

/// Lecture d'un réglage. Une erreur SQL (base verrouillée/corrompue) est
/// LOGGÉE et ramène None : « setting absent » et « défaut DB » ne doivent
/// pas être indistinguables silencieusement (l'autobackup se désactivait
/// sans trace sur un défaut DB).
pub async fn get_setting(pool: &SqlitePool, key: &str) -> Option<String> {
    match sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("lecture du réglage {key} échouée : {e}");
            None
        }
    }
}

pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Secrets (chiffrés au repos via DPAPI, voir secret.rs) ---

/// Lecture d'un secret : déchiffre `dpapi1:…` et accepte les valeurs en clair
/// écrites avant ce mécanisme (elles seront chiffrées à la prochaine
/// écriture). Un secret indéchiffrable (base restaurée sur un autre poste)
/// revient vide → le client traitera « non connecté ».
pub async fn get_secret(pool: &SqlitePool, key: &str) -> Option<String> {
    get_setting(pool, key)
        .await
        .map(|v| crate::secret::unprotect(&v))
        .filter(|v| !v.is_empty())
}

pub async fn set_secret(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    set_setting(pool, key, &crate::secret::protect(value)).await
}


/// Change le statut de traitement d'une ressource.
pub async fn set_resource_status(
    pool: &SqlitePool,
    id: i64,
    status: &str,
) -> Result<(), String> {
    if !matches!(status, "" | "todo" | "archived") {
        return Err(format!("statut inconnu : {status}"));
    }
    let updated = sqlx::query(
        "UPDATE resources SET status = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(status)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 {
        return Err(format!("ressource {id} introuvable"));
    }
    Ok(())
}

// --- Statistiques ---

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStats {
    pub total: i64,
    pub favorites: i64,
    pub never_opened: i64,
    pub by_type: Vec<(String, i64)>,
    pub top_used: Vec<Resource>,
    /// top 10 tags avec leur nombre (tags = colonne JSON → json_each)
    pub by_tag: Vec<(String, i64)>,
    /// ressources créées par mois sur 12 mois (« YYYY-MM », mois présents
    /// uniquement — le front comble les trous)
    pub activity: Vec<(String, i64)>,
    /// les plus anciennes ressources jamais ouvertes (max 8)
    pub never_opened_list: Vec<Resource>,
}

pub async fn stats(pool: &SqlitePool) -> Result<DbStats, String> {
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM resources")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let favorites: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM resources WHERE favorite = 1")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    let never_opened: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM resources WHERE open_count = 0")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    let by_type: Vec<(String, i64)> = sqlx::query_as(
        "SELECT resource_type, COUNT(*) FROM resources GROUP BY resource_type ORDER BY 2 DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    // tags : colonne JSON (["a","b"]) — json_each éclate chaque tableau,
    // les tags vides sont ignorés
    let by_tag: Vec<(String, i64)> = sqlx::query_as(
        "SELECT je.value, COUNT(*) FROM resources, json_each(resources.tags) je \
         WHERE je.value <> '' GROUP BY je.value ORDER BY 2 DESC LIMIT 10",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let activity: Vec<(String, i64)> = sqlx::query_as(
        "SELECT strftime('%Y-%m', created_at), COUNT(*) FROM resources \
         WHERE created_at >= datetime('now', '-12 months') \
         GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    // jamais ouvertes : les plus anciennes d'abord (ce sont celles qu'on
    // a le plus « oubliées ») — lignes brutes → row_to_resource
    let never_opened_list: Vec<Resource> = sqlx::query(
        "SELECT * FROM resources WHERE open_count = 0 ORDER BY created_at ASC LIMIT 8",
    )
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(row_to_resource).collect())
    .map_err(|e| e.to_string())?;
    let top_used = list_resources(
        pool,
        &ResourceFilter {
            sort_by: Some("mostUsed".into()),
            limit: Some(8),
            ..Default::default()
        },
    )
    .await?;
    Ok(DbStats {
        total,
        favorites,
        never_opened,
        by_type,
        top_used,
        by_tag,
        activity,
        never_opened_list,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Base en mémoire avec les migrations appliquées (schéma complet).
    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("pool mémoire");
        migrate(&pool).await.expect("migrations");
        pool
    }

    fn new_res(url: &str, title: &str, folder: Option<i64>) -> NewResource {
        NewResource {
            url: url.into(),
            title: title.into(),
            description: String::new(),
            resource_type: "site".into(),
            category: String::new(),
            tags: vec![],
            notes: String::new(),
            favicon: String::new(),
            favorite: false,
            meta: Default::default(),
            folder_id: folder,
            status: None,
        }
    }

    #[tokio::test]
    async fn dissolve_root_folder_releases_resources_and_reparents() {
        let pool = test_pool().await;
        // racine "Projet" avec une ressource et un sous-dossier
        let root = create_folder(&pool, "Projet", "", None).await.unwrap();
        let sub = create_folder(&pool, "Sous", "", Some(root.id))
            .await
            .unwrap();
        add_resource(&pool, &new_res("https://a.com", "A", Some(root.id)))
            .await
            .unwrap();
        // AVANT le fix, ce call échouait sur les dossiers racine (parent_id
        // NULL décodé en i64 par sqlx) : le test protège la régression.
        dissolve_folder(&pool, root.id).await.unwrap();
        let a = list_resources(
            &pool,
            &ResourceFilter {
                unfiled_only: Some(true),
                no_limit: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(a.iter().any(|r| r.title == "A"), "ressource relâchée dans la grille");
        let reparented = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT parent_id FROM folders WHERE id = ?",
        )
        .bind(sub.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reparented, None, "sous-dossier remonté à la racine");
    }

    #[tokio::test]
    async fn reorder_partial_swaps_only_listed_ids() {
        let pool = test_pool().await;
        for i in 0..5 {
            add_resource(&pool, &new_res(&format!("https://x{i}.com"), &format!("X{i}"), None))
                .await
                .unwrap();
        }
        // positions actuelles : 1..5. On échange les ids 2 et 4 :
        // elles prennent leurs slots triés [2,4] dans l'ordre demandé.
        reorder_resources(&pool, &[4, 2]).await.unwrap();
        let ordered = list_resources(
            &pool,
            &ResourceFilter {
                sort_by: Some("manual".into()),
                no_limit: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let ids: Vec<i64> = ordered.iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![1, 4, 3, 2, 5], "seules les ids listées bougent");
    }

    #[tokio::test]
    async fn reorder_normalizes_when_positions_duplicated() {
        let pool = test_pool().await;
        for i in 0..5 {
            add_resource(&pool, &new_res(&format!("https://x{i}.com"), &format!("X{i}"), None))
                .await
                .unwrap();
        }
        // cas d'une bibliothèque restaurée : toutes les positions à 0.
        sqlx::query("UPDATE resources SET position = 0")
            .execute(&pool)
            .await
            .unwrap();
        // un simple échange de slots serait un no-op → repli global :
        // la liste prend 0..n, les autres sont décalées après.
        reorder_resources(&pool, &[3, 1]).await.unwrap();
        let ordered = list_resources(
            &pool,
            &ResourceFilter {
                sort_by: Some("manual".into()),
                no_limit: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(ordered[0].id, 3, "la tête demandée est en tête");
        assert_eq!(ordered[1].id, 1);
        assert!(ordered[2..].iter().all(|r| r.position >= 2));
    }

    #[tokio::test]
    async fn restore_trash_bulk_restores_all_or_nothing() {
        let pool = test_pool().await;
        let a = add_resource(&pool, &new_res("https://a.com", "A", None))
            .await
            .unwrap();
        let b = add_resource(&pool, &new_res("https://b.com", "B", None))
            .await
            .unwrap();
        delete_resource(&pool, a.id).await.unwrap();
        delete_resource(&pool, b.id).await.unwrap();
        let trash = list_trash(&pool).await.unwrap();
        assert_eq!(trash.len(), 2);

        // restauration en masse : tout revient, aucune entrée manquante
        let ids: Vec<i64> = trash.iter().map(|t| t.trash_id).collect();
        let missing = restore_trash_bulk(&pool, &ids).await.unwrap();
        assert!(missing.is_empty());
        assert_eq!(list_trash(&pool).await.unwrap().len(), 0);
        let all = list_resources(&pool, &ResourceFilter::default()).await.unwrap();
        assert_eq!(all.len(), 2);

        // --- conflit d'URL (tout ou rien) ---
        // état de base : a.com et b.com vivent en base.
        // 1. on recrée une copie fraîche de c.com, on la supprime → en corbeille
        let c = add_resource(&pool, &new_res("https://c.com", "C", None))
            .await
            .unwrap();
        delete_resource(&pool, c.id).await.unwrap();
        // 2. on recrée c.com en base (conflit avec l'entrée corbeille ci-dessus)
        add_resource(&pool, &new_res("https://c.com", "C copie", None))
            .await
            .unwrap();
        // 3. on supprime aussi la copie de A → en corbeille, URL libre
        let a2 = add_resource(&pool, &new_res("https://a2.com", "A2", None))
            .await
            .unwrap();
        delete_resource(&pool, a2.id).await.unwrap();
        let trash = list_trash(&pool).await.unwrap();
        assert_eq!(trash.len(), 2, "C (conflit) + A2 (libre) en corbeille");
        // le lot mélange une entrée en conflit et une libre : TOUT échoue
        let err = restore_trash_bulk(
            &pool,
            &trash.iter().map(|t| t.trash_id).collect::<Vec<_>>(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("déjà enregistrée"), "erreur de conflit : {err}");
        // rien n'a bougé : la corbeille garde ses 2 entrées
        assert_eq!(list_trash(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn restore_trash_bulk_tolerates_missing_entries() {
        let pool = test_pool().await;
        let a = add_resource(&pool, &new_res("https://a.com", "A", None))
            .await
            .unwrap();
        delete_resource(&pool, a.id).await.unwrap();
        let trash = list_trash(&pool).await.unwrap();
        // un id inexistant (999) ne bloque pas la restauration des autres
        let missing = restore_trash_bulk(&pool, &[trash[0].trash_id, 999])
            .await
            .unwrap();
        assert_eq!(missing, vec![999]);
        assert!(list_trash(&pool).await.unwrap().is_empty());
    }

    fn tagged_res(url: &str, title: &str, tags: &[&str]) -> NewResource {
        let mut r = new_res(url, title, None);
        r.tags = tags.iter().map(|s| s.to_string()).collect();
        r
    }

    #[tokio::test]
    async fn rename_tag_renames_everywhere_and_counts() {
        let pool = test_pool().await;
        add_resource(&pool, &tagged_res("https://a.com", "A", &["ia", "outils"]))
            .await
            .unwrap();
        add_resource(&pool, &tagged_res("https://b.com", "B", &["IA"]))
            .await
            .unwrap();
        // sensible à la casse : seul « ia » exact est renommé
        let touched = rename_tag(&pool, "ia", "intelligence").await.unwrap();
        assert_eq!(touched, 1);
        let stats = tag_stats(&pool).await.unwrap();
        assert!(stats.iter().any(|(t, n)| t == "intelligence" && *n == 1));
        // fusion : « IA » vers « intelligence » — pas de doublon intra-ligne
        let touched = rename_tag(&pool, "IA", "intelligence").await.unwrap();
        assert_eq!(touched, 1);
        let b = get_resource(&pool, 2).await.unwrap();
        assert_eq!(b.tags, vec!["intelligence"]);
        assert_eq!(rename_tag(&pool, "ia", "ia").await.unwrap(), 0);
        assert!(rename_tag(&pool, "", "x").await.is_err());
        assert!(rename_tag(&pool, "x", "").await.is_err());
    }

    #[tokio::test]
    async fn remove_tag_clears_everywhere_and_stats_follow() {
        let pool = test_pool().await;
        add_resource(&pool, &tagged_res("https://a.com", "A", &["vieux", "garde"]))
            .await
            .unwrap();
        add_resource(&pool, &tagged_res("https://b.com", "B", &["vieux"]))
            .await
            .unwrap();
        let touched = remove_tag(&pool, "vieux").await.unwrap();
        assert_eq!(touched, 2);
        let stats = tag_stats(&pool).await.unwrap();
        assert!(!stats.iter().any(|(t, _)| t == "vieux"));
        assert!(stats.iter().any(|(t, n)| t == "garde" && *n == 1));
        assert!(remove_tag(&pool, "").await.is_err());
    }

    #[tokio::test]
    async fn integrity_ok_detects_a_healthy_memory_db() {        let pool = test_pool().await;
        assert!(integrity_ok(&pool).await, "DB mémoire fraîche = saine");
        add_resource(&pool, &new_res("https://a.com", "A", None))
            .await
            .unwrap();
        // la relit, l'intégrité reste bonne (le check ne modifie rien)
        assert!(integrity_ok(&pool).await);
    }

    #[tokio::test]
    async fn remind_at_roundtrip_and_due() {
        let pool = test_pool().await;
        let a = add_resource(&pool, &new_res("https://a.com", "A", None))
            .await
            .unwrap();
        let b = add_resource(&pool, &new_res("https://b.com", "B", None))
            .await
            .unwrap();
        // passé = échu, futur = pas échu
        set_remind_at(&pool, a.id, Some("2000-01-01 00:00:00".into()))
            .await
            .unwrap();
        set_remind_at(&pool, b.id, Some("2999-01-01 00:00:00".into()))
            .await
            .unwrap();
        let due = due_reminders(&pool, 10).await.unwrap();
        assert_eq!(due.len(), 1, "seul le rappel passé est échu");
        assert_eq!(due[0].id, a.id);
        // format invalide refusé
        assert!(set_remind_at(&pool, a.id, Some("demain".into()))
            .await
            .is_err());
        // ouvrir solde le rappel
        record_open(&pool, a.id).await.unwrap();
        assert!(due_reminders(&pool, 10).await.unwrap().is_empty());
        // effacement explicite
        set_remind_at(&pool, b.id, None).await.unwrap();
        let b2 = get_resource(&pool, b.id).await.unwrap();
        assert_eq!(b2.remind_at, None);
    }

    #[tokio::test]
    async fn cleanup_legacy_status_folders_unfiles_and_preserves_reused() {
        let pool = test_pool().await;
        // dossier-système hérité « Archivés » (racine, sans enfant) → supprimé
        let arch = create_folder(&pool, "Archivés", "", None).await.unwrap();
        let a = add_resource(&pool, &new_res("https://a.com", "A", None))
            .await
            .unwrap();
        set_resource_folder(&pool, a.id, Some(arch.id))
            .await
            .unwrap();
        // « À traiter » détourné (a un sous-dossier) → INTACT, ressources préservées
        let triage = create_folder(&pool, "À traiter", "", None).await.unwrap();
        create_folder(&pool, "Sous", "", Some(triage.id))
            .await
            .unwrap();
        let b = add_resource(&pool, &new_res("https://b.com", "B", None))
            .await
            .unwrap();
        set_resource_folder(&pool, b.id, Some(triage.id))
            .await
            .unwrap();

        let removed = cleanup_legacy_status_folders(&pool).await.unwrap();
        assert_eq!(removed, 1, "seul le dossier sans enfant part");
        // ON DELETE SET NULL : A ressort à la racine
        assert_eq!(get_resource(&pool, a.id).await.unwrap().folder_id, None);
        // B reste dans « À traiter » (détourné, non supprimé)
        assert_eq!(
            get_resource(&pool, b.id).await.unwrap().folder_id,
            Some(triage.id)
        );
        let names: Vec<String> = list_folders(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert!(names.iter().any(|n| n == "À traiter"));
        assert!(!names.iter().any(|n| n == "Archivés"));
    }

    /// Une note créée depuis un dossier ouvert (folder_id passé par le
    /// NoteEditor) doit atterrir DANS ce dossier et y être listée.
    #[tokio::test]
    async fn note_created_in_current_folder_is_listed_there() {
        let pool = test_pool().await;
        let folder = create_folder(&pool, "Projets", "", None)
            .await
            .unwrap();
        let mut note = new_res("", "Ma note", Some(folder.id));
        note.resource_type = "note".into();
        let created = add_resource(&pool, &note).await.unwrap();
        assert_eq!(created.folder_id, Some(folder.id));
        let list = list_resources(
            &pool,
            &ResourceFilter {
                folder_id: Some(folder.id),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(
            list.iter().any(|r| r.id == created.id),
            "la note doit apparaître dans le dossier courant"
        );
    }

    /// Supprimer un dossier avec sous-dossiers doit fonctionner : TOUTES les
    /// ressources (dossier + sous-dossiers) partent à la corbeille, les
    /// sous-dossiers disparaissent, la racine est restaurable.
    #[tokio::test]
    async fn delete_folder_recursively_trashes_all_resources() {
        let pool = test_pool().await;
        let root = create_folder(&pool, "Racine", "", None).await.unwrap();
        let sub = create_folder(&pool, "Sous", "", Some(root.id))
            .await
            .unwrap();
        let subsub = create_folder(&pool, "SousSous", "", Some(sub.id))
            .await
            .unwrap();
        let a = add_resource(&pool, &new_res("https://a.com", "A", Some(root.id)))
            .await
            .unwrap();
        let b = add_resource(&pool, &new_res("https://b.com", "B", Some(sub.id)))
            .await
            .unwrap();
        let c = add_resource(&pool, &new_res("https://c.com", "C", Some(subsub.id)))
            .await
            .unwrap();
        // hors du dossier : ne doit PAS partir à la corbeille
        let outside =
            add_resource(&pool, &new_res("https://d.com", "D", None))
                .await
                .unwrap();

        let trashed = delete_folder(&pool, root.id).await.unwrap();
        assert_eq!(trashed, 3, "les 3 ressources du dossier sont à la corbeille");

        // dossiers disparus
        let names: Vec<String> = list_folders(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert!(!names.iter().any(|n| n == "Racine"));
        assert!(!names.iter().any(|n| n == "Sous"));
        assert!(!names.iter().any(|n| n == "SousSous"));

        // ressources : toutes en corbeille sauf celle dehors
        assert!(get_resource(&pool, a.id).await.is_err());
        assert!(get_resource(&pool, b.id).await.is_err());
        assert!(get_resource(&pool, c.id).await.is_err());
        assert!(get_resource(&pool, outside.id).await.is_ok());

        // la corbeille contient les 3 entrées ; restaurer A remet la
        // ressource à la racine (son dossier n'existe plus)
        let trash = list_trash(&pool).await.unwrap();
        assert_eq!(trash.len(), 3);
        let entry_a = trash
            .iter()
            .find(|e| e.resource.id == a.id)
            .expect("entrée corbeille de A");
        let restored = restore_trash(&pool, entry_a.trash_id).await.unwrap();
        assert_eq!(restored.title, "A");
        assert_eq!(
            restored.folder_id, None,
            "le dossier restauré n'existe plus : ressource à la racine"
        );
    }
}
