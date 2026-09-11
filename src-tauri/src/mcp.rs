use crate::db::{self, NewResource, Resource, ResourceFilter};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, ErrorData as McpError, Implementation,
            ServerCapabilities, ServerInfo, ProtocolVersion},
    schemars,
    ServerHandler,
    tool, tool_handler, tool_router,
};
use serde::Deserialize;
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct VaultlyMcp {
    pool: SqlitePool,
}

impl VaultlyMcp {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[tool_router]
impl VaultlyMcp {
    #[allow(dead_code)]
    pub fn new_router() -> Self {
        unreachable!() // jamais appelé : présent pour la macro tool_router
    }

    #[tool(description = "Recherche plein texte dans les ressources enregistrées (titre, URL, description, notes, tags). Retourne les correspondances, favoris et récentes d'abord. Utilise-la quand l'utilisateur cherche un site, une app ou un outil qu'il a enregistré.", annotations(title = "Rechercher des ressources", read_only_hint = true))]
    async fn search_resources(
        &self,
        Parameters(SearchParams { query, limit }): Parameters<SearchParams>,
    ) -> Result<CallToolResult, McpError> {
        let filter = ResourceFilter {
            query,
            limit: limit.or(Some(20)),
            ..Default::default()
        };
        let results = db::list_resources(&self.pool, &filter)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        Ok(CallToolResult::success(resource_blocks(results)))
    }

    #[tool(description = "Liste les ressources, avec filtres optionnels : resource_type (site, app, repo, outil, article, video, autre), category, tag, favorite (bool), limit, sort_by (recent|mostUsed|manual|title|added|oldest). Sans filtre, retourne les plus récentes.", annotations(title = "Lister les ressources", read_only_hint = true))]
    async fn list_resources(
        &self,
        Parameters(ListParams {
            resource_type,
            category,
            tag,
            favorite,
            limit,
            sort_by,
        }): Parameters<ListParams>,
    ) -> Result<CallToolResult, McpError> {
        // tri validé : une valeur inconnu retombe sur le défaut (recent)
        // au lieu d'être injectée dans l'ORDER BY
        let sort_by = sort_by.filter(|s| {
            matches!(
                s.as_str(),
                "recent" | "mostUsed" | "manual" | "title" | "added" | "oldest"
            )
        });
        let filter = ResourceFilter {
            resource_type,
            category,
            tag,
            favorite,
            limit: limit.or(Some(50)),
            sort_by,
            ..Default::default()
        };
        let results = db::list_resources(&self.pool, &filter)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        Ok(CallToolResult::success(resource_blocks(results)))
    }

    #[tool(description = "Retourne le détail complet d'une ressource par son id (tous les champs, y compris notes personnelles).", annotations(title = "Obtenir une ressource", read_only_hint = true))]
    async fn get_resource(
        &self,
        Parameters(GetParams { id }): Parameters<GetParams>,
    ) -> Result<CallToolResult, McpError> {
        match db::get_resource(&self.pool, id).await {
            Ok(r) => Ok(CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&r).unwrap_or_default(),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Enregistre une nouvelle ressource. url et title obligatoires ; resource_type parmi site|app|repo|outil|article|video|autre ; tags = liste de mots-clés. Échoue si l'URL existe déjà. Les liens doivent être http(s) (pas de chemins d'exécutable locaux : l'ajout d'apps se fait via l'interface).", annotations(title = "Ajouter une ressource"))]
    async fn add_resource(
        &self,
        Parameters(AddParams {
            url,
            title,
            description,
            resource_type,
            category,
            tags,
            notes,
        }): Parameters<AddParams>,
    ) -> Result<CallToolResult, McpError> {
        if url.trim().is_empty() {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "l'URL est obligatoire".to_string(),
            )]));
        }
        // exe: (et file:) = lancement de binaires locaux : réservé à l'UI
        // locale, jamais à un client MCP qui pourrait être piloté par du
        // contenu externe (prompt injection → exécution arbitraire).
        let lower = url.trim().to_lowercase();
        if lower.starts_with("exe:") || lower.starts_with("file:") {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "les chemins d'exécutable (exe:) ne peuvent pas être ajoutés via MCP — utilise l'interface de Vaultly".to_string(),
            )]));
        }
        let new = NewResource {
            url,
            title,
            description: description.unwrap_or_default(),
            resource_type: resource_type.unwrap_or_else(|| "site".into()),
            category: category.unwrap_or_default(),
            tags: tags.unwrap_or_default(),
            notes: notes.unwrap_or_default(),
            favicon: String::new(),
            favorite: false,
            meta: Default::default(),
            folder_id: None,
            status: None,
        };
        // même normalisation que l'UI et /api/add : favicon s2 automatique
        let new = match crate::commands::normalize_url(new) {
            Ok(n) => n,
            Err(e) => return Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        };
        let new = if new.favicon.is_empty() && new.url.starts_with("http") {
            let mut n = new;
            n.favicon = crate::commands::favicon_for(&n.url);
            n
        } else {
            new
        };
        match db::add_resource(&self.pool, &new).await {
            Ok(r) => Ok(CallToolResult::success(vec![ContentBlock::text(
                format!("Ressource ajoutée (id {}) : {} — {}", r.id, r.title, r.url),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Met à jour une ressource existante (identifiée par id). Seuls les champs fournis écrasent l'existant.", annotations(title = "Mettre à jour une ressource"))]
    async fn update_resource(
        &self,
        Parameters(UpdateParams {
            id,
            url,
            title,
            description,
            resource_type,
            category,
            tags,
            notes,
            status,
            meta,
        }): Parameters<UpdateParams>,
    ) -> Result<CallToolResult, McpError> {
        // ressource introuvable = erreur métier (pas une erreur de protocole) :
        // même format que get/add/delete pour que le client LLM la lise bien
        let existing = match db::get_resource(&self.pool, id).await {
            Ok(r) => r,
            Err(e) => return Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        };
        // garde exe: : pas de retournement d'une ressource en lanceur de
        // binaire arbitraire via update_resource (même motif que add_resource)
        if let Some(url) = url.as_deref() {
            let lower = url.trim().to_lowercase();
            if lower.starts_with("exe:") || lower.starts_with("file:") {
                return Ok(CallToolResult::error(vec![ContentBlock::text(
                    "les chemins d'exécutable (exe:) ne peuvent pas être définis via MCP — utilise l'interface de Vaultly".to_string(),
                )]));
            }
        }
        // meta fourni par un client MCP : jamais de chemins exécutables
        // (exePath/filePath) — l'URL étant gardée, ces deux clés étaient le
        // seul autre chemin vers un lancement de binaire.
        let meta = match meta {
            Some(mut m) => {
                m.remove("exePath");
                m.remove("filePath");
                m
            }
            None => existing.meta.clone(),
        };
        // statut : mêmes valeurs admises que l'UI et le backend
        if let Some(s) = status.as_deref() {
            if !matches!(s, "" | "todo" | "archived") {
                return Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                    "statut inconnu : {s} (valeurs admises : \"\" actif, todo, archived)"
                ))]));
            }
        }
        let new = NewResource {
            url: url.unwrap_or(existing.url),
            title: title.unwrap_or(existing.title),
            description: description.unwrap_or(existing.description),
            resource_type: resource_type.unwrap_or(existing.resource_type),
            category: category.unwrap_or(existing.category),
            tags: tags.unwrap_or(existing.tags),
            notes: notes.unwrap_or(existing.notes),
            favicon: existing.favicon,
            favorite: existing.favorite,
            meta,
            folder_id: existing.folder_id,
            status: Some(status.unwrap_or(existing.status.clone())),
        };
        // même normalisation qu'à l'ajout : URL sans schéma ou vide refusée
        let new = match crate::commands::normalize_url(new) {
            Ok(n) => n,
            Err(e) => return Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        };
        match db::update_resource(&self.pool, id, &new).await {
            Ok(r) => Ok(CallToolResult::success(vec![ContentBlock::text(
                format!("Ressource {} mise à jour : {} — {}", r.id, r.title, r.url),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Déplace une ressource à la corbeille (restaurable 30 jours) par son id. Destructif en apparence : ne l'appelle que si l'utilisateur demande explicitement la suppression.", annotations(title = "Supprimer une ressource", destructive_hint = true, idempotent_hint = true))]
    async fn delete_resource(
        &self,
        Parameters(GetParams { id }): Parameters<GetParams>,
    ) -> Result<CallToolResult, McpError> {
        match db::delete_resource(&self.pool, id).await {
            Ok(()) => Ok(CallToolResult::success(vec![ContentBlock::text(
                format!("Ressource {id} déplacée à la corbeille (restaurable 30 jours)."),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Liste les dossiers (groupements de ressources) avec leur contenu : id, nom, nombre de ressources, ressources jamais ouvertes. Utilise les ids pour move_to_folder.", annotations(title = "Lister les dossiers", read_only_hint = true))]
    async fn list_folders(&self) -> Result<CallToolResult, McpError> {
        match db::list_folders(&self.pool).await {
            Ok(folders) => {
                let lines: Vec<String> = folders
                    .iter()
                    .map(|f| {
                        format!(
                            "{}. {} — {} ressource(s), {} jamais ouverte(s)",
                            f.id, f.name, f.count, f.unseen
                        )
                    })
                    .collect();
                Ok(CallToolResult::success(vec![ContentBlock::text(if lines.is_empty() {
                    "Aucun dossier.".to_string()
                } else {
                    lines.join("
")
                })]))
            }
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Range une ressource dans un dossier (folder_id = id du dossier, ou null pour la sortir de tout dossier). Utilise list_folders pour trouver les ids.", annotations(title = "Ranger dans un dossier"))]
    async fn move_to_folder(
        &self,
        Parameters(MoveParams { resource_id, folder_id }): Parameters<MoveParams>,
    ) -> Result<CallToolResult, McpError> {
        match db::set_resource_folder(&self.pool, resource_id, folder_id).await {
            Ok(()) => Ok(CallToolResult::success(vec![ContentBlock::text(match folder_id {
                Some(fid) => format!("Ressource {resource_id} rangée dans le dossier {fid}."),
                None => format!("Ressource {resource_id} sortie de son dossier."),
            })])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Lance une application Windows enregistrée (une ressource de type app avec un chemin d'exécutable). Cherche-la d'abord avec search_resources.", annotations(title = "Lancer une app"))]
    async fn launch_app(
        &self,
        Parameters(GetParams { id }): Parameters<GetParams>,
    ) -> Result<CallToolResult, McpError> {
        let r = db::get_resource(&self.pool, id).await;
        match r {
            Ok(res) if res.url.starts_with("exe:") => {
                let exe = res.meta.get("exePath").cloned().unwrap_or_else(|| res.url[4..].to_string());
                // via token MCP : .exe uniquement. .bat/.cmd/.lnk ouvrent la
                // voie à l'exécution de script/arbitraire — réservés au clic
                // utilisateur direct dans l'UI, jamais à un appel piloté.
                let ext = std::path::Path::new(&exe)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if ext != "exe" {
                    return Ok(CallToolResult::error(vec![ContentBlock::text(
                        "lancement distant restreint aux .exe (les .bat/.cmd/.lnk exigent un clic dans l'interface)".to_string(),
                    )]));
                }
                match crate::commands::launch_executable_sync(&exe) {
                    Ok(()) => Ok(CallToolResult::success(vec![ContentBlock::text(
                        format!("App lancée : {}", res.title),
                    )])),
                    Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
                }
            }
            Ok(res) => Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                "« {} » n'est pas une app exécutable (type : {}). Utilise l'URL {} à la place.",
                res.title, res.resource_type, res.url
            ))])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Crée un dossier (groupement de ressources) et retourne son id. parent_id optionnel pour imbriquer dans un dossier existant (voit list_folders). Range ensuite les ressources avec move_to_folder.", annotations(title = "Créer un dossier"))]
    async fn create_folder(
        &self,
        Parameters(CreateFolderParams { name, parent_id }): Parameters<CreateFolderParams>,
    ) -> Result<CallToolResult, McpError> {
        match db::create_folder(&self.pool, &name, "", parent_id).await {
            Ok(f) => Ok(CallToolResult::success(vec![ContentBlock::text(format!(
                "Dossier créé (id {}) : {}",
                f.id, f.name
            ))])),
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Vérifie l'état de santé des liens web de la bibliothèque (404/410/5xx/erreur réseau = mort). Peut prendre plusieurs secondes sur une grosse base. Retourne la liste des liens morts avec leur id de ressource et la raison.", annotations(title = "Vérifier les liens morts"))]
    async fn check_dead_links(&self) -> Result<CallToolResult, McpError> {
        match crate::commands::run_dead_link_check(&self.pool).await {
            Ok(dead) => {
                if dead.is_empty() {
                    Ok(CallToolResult::success(vec![ContentBlock::text(
                        "Tous les liens web répondent.".to_string(),
                    )]))
                } else {
                    let lines: Vec<String> = dead
                        .iter()
                        .map(|d| format!("{}. {} — {} ({})", d.id, d.title, d.url, d.reason))
                        .collect();
                    Ok(CallToolResult::success(vec![ContentBlock::text(format!(
                        "{} lien(s) mort(s) :\n{}",
                        dead.len(),
                        lines.join("\n")
                    ))]))
                }
            }
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }

    #[tool(description = "Statistiques de la bibliothèque : total, favoris, jamais ouvertes, répartition par type, top des plus utilisées.", annotations(title = "Statistiques", read_only_hint = true))]
    async fn get_stats(&self) -> Result<CallToolResult, McpError> {
        match db::stats(&self.pool).await {
            Ok(s) => {
                let by_type = s
                    .by_type
                    .iter()
                    .map(|(t, n)| format!("  - {t} : {n}"))
                    .collect::<Vec<_>>()
                    .join("
");
                let top = s
                    .top_used
                    .iter()
                    .take(5)
                    .map(|r| format!("  - {} ({} ouvertures)", r.title, r.open_count))
                    .collect::<Vec<_>>()
                    .join("
");
                Ok(CallToolResult::success(vec![ContentBlock::text(format!(
                    "Total : {}
Favoris : {}
Jamais ouvertes : {}
Par type :
{}
Top utilisation :
{}",
                    s.total, s.favorites, s.never_opened, by_type, top
                ))]))
            }
            Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
        }
    }
}

#[tool_handler]
impl ServerHandler for VaultlyMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(Implementation::from_build_env())
        .with_protocol_version(ProtocolVersion::V_2026_07_28)
        .with_instructions(
            "Vaultly : hub personnel de ressources (sites web, apps, outils). \
             Utilise search_resources quand l'utilisateur cherche un site/outil précis \
             (recherche plein texte sur titre, URL, description, notes, tags), \
             list_resources pour parcourir par type/catégorie/tag, \
             get_resource pour le détail complet, add_resource pour enregistrer \
             une nouvelle ressource. La base est locale et personnelle : \
             ne supprime jamais sans demande explicite (delete_resource est destructif).",
        )
    }
}

fn resource_blocks(resources: Vec<Resource>) -> Vec<ContentBlock> {
    if resources.is_empty() {
        return vec![ContentBlock::text("Aucune ressource trouvée.".to_string())];
    }
    let lines: Vec<String> = resources
        .iter()
        .map(|r| {
            let tags = if r.tags.is_empty() {
                String::new()
            } else {
                format!(" [{}]", r.tags.join(", "))
            };
            let fav = if r.favorite { "★ " } else { "" };
            format!("{}. {fav}{} — {} ({}){tags}", r.id, r.title, r.url, r.resource_type)
        })
        .collect();
    vec![ContentBlock::text(lines.join("\n"))]
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchParams {
    /// Texte à rechercher
    pub query: String,
    /// Nombre max de résultats (défaut 20)
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListParams {
    /// Type : site, app, repo, outil, article, video, autre
    pub resource_type: Option<String>,
    /// Catégorie exacte
    pub category: Option<String>,
    /// Tag exact
    pub tag: Option<String>,
    /// Seulement les favoris
    pub favorite: Option<bool>,
    /// Nombre max de résultats (défaut 50)
    pub limit: Option<i64>,
    /// Tri : recent (défaut), mostUsed, manual, title, added, oldest
    pub sort_by: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CreateFolderParams {
    /// Nom du dossier
    pub name: String,
    /// Dossier parent (imbrication), null = racine
    pub parent_id: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetParams {
    /// Identifiant numérique de la ressource
    pub id: i64,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddParams {
    /// URL complète (http/https)
    pub url: String,
    /// Titre lisible
    pub title: String,
    pub description: Option<String>,
    /// site, app, repo, outil, article, video ou autre
    pub resource_type: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    /// Notes personnelles
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MoveParams {
    /// id de la ressource à ranger
    pub resource_id: i64,
    /// id du dossier cible (null pour sortir de tout dossier)
    pub folder_id: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateParams {
    /// Identifiant numérique de la ressource à modifier
    pub id: i64,
    pub url: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub resource_type: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    /// statut de traitement : "" (actif), "todo" ou "archived"
    pub status: Option<String>,
    /// champs spécifiques au type (platform, language, exePath…)
    pub meta: Option<std::collections::BTreeMap<String, String>>,
}
