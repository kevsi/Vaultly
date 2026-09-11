# Changelog

Tous les changements notables de Vaultly sont documentés ici, en suivant
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) (les versions suivent
[SemVer](https://semver.org/lang/fr/)).

## [Unreleased]

### Ajouté
- Tuiles : vignette 16:9 pleine tuile pour les vidéos avec miniature
  (prioritaire sur la capture mShots).

### Corrigé
- Sniff YouTube/TikTok via oEmbed (titre propre, miniature garantie) ;
  `hqdefault` au lieu de `oardefault` (404 sur la majorité des vidéos) ;
  TikTok détecté comme vidéo.
- Aperçus d'icônes génériques : endpoint BATCH d'Iconify en séquentiel
  (cause réelle des 429 : 48 hits `/{id}.svg` parallèles) + cache module.
- Dédoublonnage : le bloc « déjà enregistré » est masqué pour les plateformes
  vidéo et reformulé « tu as déjà N liens sur… » (c'était un indice, pas un
  refus).
- Modale vidéo : `min-w-0` sur l'en-tête (titre long débordait et se faisait
  clipper).
- Audit avant release : 8 bugs UX + 3 failles backend corrigés +
  durcissements (voir SECURITY.md).

## [1.0.2] - 2026-09-11

### Ajouté
- Aperçu vidéo in-app : modal lecteur YouTube / TikTok / Vimeo / Dailymotion /
  Twitch (+ choix « ouvrir dans l'app ou le navigateur ») ; TikTok accepté à
  l'ajout ; tests `videoEmbed`.
- Soutien via Ko-fi uniquement (ko-fi.com/kevroughi) ; `Ctrl+Maj+flèches`
  bascule en tri « Placement » au lieu de rester muet.

### Corrigé
- CI : création de release (permissions `contents: write` pour `GITHUB_TOKEN`)
  et `@types/node` en devDependency (`tsc` CI et `node:fs`).
- Icônes : bannière CDN fantôme à la pagination (dead par vue + bannière sur
  la page courante), pagination stable sur liste complète, shadowing de `t()`
  corrigé.
- Modale vidéo compacte en phase choix, boutons `sm` centrés ; lecteur agrandi
  (94 vw max 1400 px, plafonné en hauteur).

## [1.0.1] - 2026-09-11

### Corrigé
- Installation : suppression récursive des dossiers (tout part à la
  corbeille) ; CSP `img-src` élargie (favicons relayés par MCP/imports) ;
  repli visuel des aperçus de dossier.

## [1.0.0] - 2026-09-11

### Ajouté
- Premier lancement : diaporama animé (3 slides, icônes Lottie vectorielles
  maison, `prefers-reduced-motion` respecté) enchaîné sur une visite guidée
  Driver.js (7 étapes ciblant la vraie interface). Une seule fois ; relançable
  via Réglages › « Revoir la visite guidée ».
- Smart Clip : coller une URL devine le type (repo/vidéo/article/outil/site) et
  pré-remplit titre, description, image (miniature YouTube incluse) et tags —
  sans jamais écraser un choix manuel.
- Moisson d'onglets : l'extension range tous les onglets web de la fenêtre dans
  un dossier daté (« Onglets · AAAA-MM-JJ ») via `POST /api/add-bulk`
  (bornée, garde de schéma, token add-only).
- Vue « Tableau » (kanban) : cartes groupées par statut (À traiter / En cours /
  Fait), déplaçables par glisser ou via les flèches ◀ ▶.
- Rubrique Apparence : 5 styles d'ambiance (Carnet, Pro, Anime, Néon, Forêt),
  5 typographies, 5 styles de boutons (dont Manga et Néon), arrière-plans
  (dégradés, image personnelle, voile d'assombrissement)
- Modale d'ajout en 2 étapes (cartes de types → formulaire compact sans scroll)
- Bibliothèque d'icônes : 3459 logos d'apps (Simple Icons) + icônes
  génériques (Iconify), recherche en français, pagination
- Avertissement de doublon à l'ajout (URL exacte, renvoi vers l'existant)
- Gestionnaire de tags (renommer, fusionner, supprimer partout)
- Revue « À revisiter » (jamais ouvertes depuis 60 jours) + archivage en masse
- Vérification auto des liens morts (quotidienne) + pastille Réglages
- Navigateur d'ouverture et application de notes au choix (Réglages › Ouverture)
- Rappels « me rappeler dans… » (toast au lancement, soldés à l'ouverture)
- Aide-mémoire des raccourcis (bouton clavier dans l'en-tête)
- Ouverture du dossier des logs (Réglages › Général) pour le support
- Auto-récupération d'une base corrompue au démarrage (mise de côté de
  l'originale + restauration de la sauvegarde la plus récente)
- Licenses : projet placé sous licence MIT (fichier `LICENSE`)
- Mises à jour automatiques depuis GitHub Releases (contrôle quotidien)
- Imports HTML Netscape et CSV (Pocket, Raindrop)
- Captures mshots préchauffées à l'ajout + shimmer de chargement
- Tests automatisés (vitest + Rust) et lint Biome dans la CI

### Modifié
- Classement par état : le champ `status` devient la seule source de vérité.
  Fin des dossiers-système auto-créés (« À traiter » / « Archivés ») qui
  arrachaient une ressource de son vrai dossier. Archiver/marquer ne touchent
  plus que le statut ; l'accueil masque les archivés, le filtre « Statut » et
  le Kanban les rendent visibles.
- Nettoyage one-shot au démarrage : suppression des dossiers-système hérités
  (« À traiter » / « Archivés ») ; leurs ressources ressortent à la racine en
  gardant leur statut (`ON DELETE SET NULL`). Un dossier de ce nom réutilisé
  (avec sous-dossiers) est laissé intact.

### Optimisé & sécurité (audit avant release)
- Tableau (kanban) : la barre de pagination et les filtres « Statut » /
  « À revisiter » sont masqués en mode tableau (ignorés par cette vue).
- Base : index ajoutés (`folder_id`, `status`, `remind_at`, `updated_at`,
  `created_at`, `open_count`) — fin des scans/tris complets sur grosses bases.
- CI : scan de dépendances ajouté (`pnpm audit` bloquant niveau high +
  `cargo audit` RustSec).
- Retrait de la commande IPC morte `categories_with_counts` (plus de
  consommateur depuis la suppression du filtre « Catégories »).
- Bundle : `createUpdaterArtifacts: true` — condition pour des mises à jour
  réellement signées (requiert aussi `plugins.updater.pubkey` + secrets CI).
- WebDAV : avertissement (UI + log) quand l'URL est en `http://` vers un hôte
  distant (identifiants en clair), sans bloquer les NAS en réseau local.
- Erreurs UI centralisées via `describeError` (préfixe technique retiré,
  message borné) sur les ~50 points d'affichage d'erreur.

### Corrigé
- Installeur : `mainBinaryName` « Vaultly » (exe cohérent avec le nom
  d'affichage).
- Fenêtre sans decorations : contrôles minimiser/agrandir/fermer intégrés à la
  toolbar, zone de drag + maximize au double-clic (comportement Windows).
- Grille paginée : placement de la barre dans la toolbar (fil d'Ariane en
  dossier, à droite de « Statut » à la racine) au lieu du bas de page.
- Faux positif « Cette URL est déjà dans ta bibliothèque » affiché à chaque
  clic sur « Modifier » : la détection de doublon ignore désormais la ressource
  en cours d'édition (seule une AUTRE ligne portant la même URL déclenche
  l'avertissement).
- Thème 100 % sombre natif (le mode clair est retiré)
- Fiche Détails : crash potentiel à la fermeture (hook après return)

## [0.2.0] - 2026-09-01

### Ajouté
- Corbeille 30 jours, dossiers imbriqués, statuts (à traiter, archivés)
- Serveur MCP intégré + extension navigateur (token add-only)
- Sauvegarde WebDAV (manuelle + automatique), export/import JSON
- Capture presse-papiers, palette globale, lancement au démarrage
- Wayback Machine pour les liens morts
