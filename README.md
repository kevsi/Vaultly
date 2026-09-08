# Vaultly

Hub personnel de ressources — sites web, apps, outils — avec accès IA intégré via MCP.

> Anciennement **ConnectAll** : au premier lancement après renommage, l'app
> migre automatiquement ses données (`%APPDATA%\com.alexanders.connectall`
> et `Documents\ConnectAll`) vers les nouveaux dossiers.

## Pourquoi

Ne plus jamais perdre un site utile : toutes tes ressources dans une base locale,
recherchables, classées, et **exploitables par tes assistants IA** (ZCode, Claude,
Cursor…) pendant que l'app est ouverte.

## Fonctionnalités

- **Bibliothèque** : CRUD complet, recherche plein texte (raccourci `/`), filtres par
  type/catégorie/tag/favori/statut, tri manuel par glisser-déposer (trait d'insertion
  entre tuiles, dépôt au centre = création de dossier) ou au clavier (Ctrl+Maj+←/→),
  dossiers imbriquables, **corbeille 30 jours** restaurable depuis Réglages
- **Notes post-it** : contenu riche (gras, listes, liens), couleurs, tags
- **Palette de commandes** : `Ctrl+K` dans l'app, `Ctrl+Alt+Espace` partout dans Windows ;
  coller une URL dedans propose de l'ajouter directement (barre de capture)
- **Launcher permanent** : icône dans la barre des tâches (la croix masque l'app,
  « Quitter » sauvegarde puis ferme), démarrage automatique à l'ouverture de session
  (désactivable dans Réglages)
- **Serveur MCP intégré** (HTTP streamable, `127.0.0.1:8765/mcp`) : l'IA peut chercher,
  consulter, ajouter, modifier, supprimer, créer des dossiers, vérifier les liens morts
  et lancer des apps — **12 outils** exposés
- **Extension navigateur** (Brave/Chrome/Edge, dossier `extension/`) : ajoute la page
  courante en un clic via `POST /api/add`, avec un **token add-only** séparé du token MCP
- **Dédoublonnage intelligent** : les URLs sont canonisées (`www.`, `/` final, paramètres
  de tracking `utm_*`/`gclid`/`fbclid` retirés) — plus de tuiles en double pour un même site
- **Import de favoris** : Brave, Chrome, Edge et Firefox (détection auto des profils,
  favoris synchronisés inclus, dédoublonnage par URL, dossiers convertis en tags)
- **Liens morts & archivage** : vérification des 404/410/5xx, et par lien mort un bouton
  « Archiver » qui retrouve une capture sur **archive.org** (ou en demande une)
- **Sauvegarde** : export/import JSON, backup automatique à la fermeture/masquage
  (`Documents\Vaultly\Sauvegardes`), et backup optionnel sur **Google Drive**
  (OAuth desktop + PKCE, sauvegarde auto à intervalle réglable)
- **Thème** : le sombre/clair suit celui de Windows tant qu'aucun choix manuel n'a été
  fait ; ensuite ton choix reste
- **Local d'abord** : SQLite dans `%APPDATA%\com.kevsi.vaultly`, jetons
  chiffrés au repos (DPAPI). Aucune donnée n'est envoyée sauf ce que tu déclenches :
  favicons via le service Google s2, captures d'écran optionnelles via mShots
  (`s.wordpress.com`), archives via `archive.org` (clic explicite), et backup Drive
  si tu le connectes

## Démarrage

```bash
pnpm install
pnpm tauri dev      # développement
pnpm tauri build    # exécutable de production (NSIS + MSI)
```

Prérequis : Node 22, pnpm, Rust (MSVC) — [guide Tauri](https://tauri.app/start/prerequisites/).

Pour embarquer le Client Secret Google Drive au build (sinon la connexion Drive
demande la variable d'environnement `GDRIVE_CLIENT_SECRET`) : définis-la sur la
machine qui construit l'installateur — elle n'est jamais dans le dépôt.

## Connecter une IA

Ouvre l'app → onglet **Réglages** : les tokens et des snippets prêts à coller
pour ZCode (`~/.zcode/cli/config.json`), Claude Code et Cursor y sont générés.

Le serveur MCP exige l'en-tête `Authorization: Bearer <token>` ; deux tokens
coexistent — le **token MCP** (plein accès, clients IA) et le **token de
l'extension** (ajout uniquement). Ils sont générés au premier lancement,
chiffrés (DPAPI) et régénérables en un clic.

## Stack

Tauri 2 · React 19 · TypeScript · Tailwind 4 + shadcn/ui (Base UI) · sqlx/SQLite ·
rmcp 3 (Model Context Protocol) · axum

## Structure

```
src/                  # frontend React
  components/         # vues (Bibliothèque, Importer, Stats, Réglages) + tuiles/modales
  lib/                # wrappers invoke, types, sanitisation HTML des notes
src-tauri/
  migrations/         # schéma SQLite (0001→0007)
  src/
    lib.rs            # setup Tauri : DB, plugins, raccourci global, backups auto
    db.rs             # couche données partagée UI + MCP (ressources, dossiers, settings)
    commands.rs       # commandes Tauri (pont invoke) : CRUD, import/export, Drive
    mcp.rs            # serveur MCP : 12 outils rmcp
    server.rs         # axum : auth Bearer à deux jetons, /api/add, choix du port
    gdrive.rs         # OAuth desktop + PKCE, upload, backup/restauration Drive
    metadata.rs       # récupération titre/favicon d'une page web
    scan.rs           # lecture favoris Brave/Chrome/Edge/Firefox
    secret.rs         # chiffrement DPAPI des jetons au repos
extension/            # extension MV3 (popup + token add-only)
vaultly-landing/      # page de téléchargement (installateurs + SHA256)
```
