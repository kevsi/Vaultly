/**
 * i18n minimaliste maison (aucune dépendance) : dictionnaires FR/EN,
 * persistance `vaultly-lang`, hook réactif `useI18n()` via
 * useSyncExternalStore. Le français est la langue de référence : toute
 * clé absente du dictionnaire FR retombe sur la clé elle-même.
 */

export type Lang = "fr" | "en";

import { useSyncExternalStore } from "react";

const LANG_KEY = "vaultly-lang";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Dict = Record<string, string>;

const fr: Dict = {
  // --- App shell ---
  settings: "Réglages",
  "nav.library": "Bibliothèque",
  "nav.import": "Importer",
  "nav.stats": "Statistiques",
  "nav.trash": "Corbeille",
  "nav.settings": "Réglages",
  "win.minimize": "Réduire",
  "win.maximize": "Agrandir",
  "win.restore": "Restaurer",
  "win.close": "Fermer",
  "win.closeHint":
    "Fermer masque l'app dans la barre des tâches — la palette la fait resurgir.",
  "shortcuts.title": "Raccourcis clavier",
  // --- Library toolbar ---
  "lib.search": "Rechercher…  (raccourci : /)",
  "lib.sort": "Trier",
  "lib.favorites": "Favoris seulement",
  "lib.stale": "À revisiter : jamais ouvertes depuis 60 jours",
  "lib.captures": "Voir les captures d'écran des sites (au lieu des favicons)",
  "lib.view.grid": "Affichage en tuiles",
  "lib.view.list": "Affichage en liste",
  "lib.view.board": "Tableau (kanban par statut)",
  "lib.refresh":
    "Rafraîchir (recolle les ressources et retente le chargement des images)",
  "lib.openFolder": "Ouvrir le dossier de ressources (Documents\\Vaultly)",
  "lib.select": "Sélectionner des ressources pour agir en masse",
  "lib.select.exit": "Quitter",
  "lib.select.select": "Sélectionner",
  "lib.cloud": "Joindre un fichier depuis le cloud (WebDAV)",
  "lib.cloud.label": "Depuis le cloud",
  "lib.tags": "Gérer les tags (renommer, fusionner, supprimer)",
  "lib.tags.label": "Tags",
  "lib.note": "Nouvelle note (Ctrl+Alt+N)",
  "lib.note.label": "Note",
  "lib.add": "Ajouter",
  "lib.filter.type.all": "Tout",
  "lib.filter.tags": "Tags",
  "lib.filter.tags.all": "Tous les tags",
  "lib.filter.status": "Statut",
  "lib.filter.status.all": "Tout",
  "lib.filter.status.active": "Actif",
  "lib.filter.status.todo": "À faire",
  "lib.filter.status.archived": "Archivé",
  "lib.filter.category": "Catégories",
  // --- Library states ---
  "lib.empty.title": "Ta bibliothèque est vide",
  "lib.empty.desc":
    "Ajoute ta première ressource, ou importe tes favoris depuis l'onglet Importer.",
  "lib.empty.add": "Ajouter une ressource",
  "lib.empty.filtered.title": "Aucun résultat",
  "lib.empty.filtered.desc":
    "Essaie une autre recherche ou retire les filtres.",
  "lib.stale.empty.title": "Rien à revisiter 🎉",
  "lib.stale.empty.desc": "Toutes tes ressources ont été ouvertes récemment.",
  "lib.loadError": "Impossible de charger ta bibliothèque.",
  "lib.retry": "Tout réessayer",
  "lib.cap500":
    "Un très grand nombre de résultats — affine ta recherche ou ajoute un filtre pour tout voir.",
  "lib.refresh.done": "Rafraîchi",
  "lib.bulk.selected": "sélectionnée",
  "lib.bulk.selectAll": "Tout sélectionner",
  "lib.bulk.deselect": "Tout désélectionner",
  "lib.bulk.archive": "Archiver",
  "lib.bulk.delete": "Supprimer",
  "lib.archived": "Archivé",
  "lib.todo": "À faire",
  "lib.revisit": "à revisiter",
  "lib.resources": "ressource(s)",
  "lib.deleted": "moved to trash",
  // --- Sorts ---
  "sort.recent": "Récents",
  "sort.added": "Ajoutés",
  "sort.oldest": "Anciens",
  "sort.mostUsed": "Plus utilisés",
  "sort.manual": "Placement",
  "sort.title": "A→Z",
  // --- Common ---
  "common.cancel": "Annuler",
  "common.close": "Fermer",
  "common.next": "Suivant",
  "common.prev": "Précédent",
  "common.finish": "Terminer",
  "common.skip": "Passer",
  // --- Onboarding ---
  "onb.welcome.title": "Bienvenue dans Vaultly",
  "onb.welcome.text":
    "Ton hub personnel : tous tes bons sites, apps, fichiers et notes, réunis en tuiles.",
  "onb.organize.title": "Range sans effort",
  "onb.organize.text":
    "Dossiers imbriqués, tags, favoris, tableau par statut. Les doublons sont fusionnés tout seul.",
  "onb.ai.title": "Retrouve et connecte ton IA",
  "onb.ai.text":
    "Recherche instantanée, palette n'importe où, et tes assistants IA qui lisent ta bibliothèque.",
  "onb.cta": "Découvrir l'interface",
  // --- Soutenir ---
  "support.title": "Soutenir Vaultly",
  "support.text":
    "Vaultly est gratuit, sans publicité et sans compte. Si l'app te sert au quotidien, un don — même petit — aide à garder le projet vivant : hébergement, temps de développement, nouvelles fonctionnalités.",
  "support.sponsors": "GitHub Sponsors",
  "support.kofi": "Ko-fi (dons ponctuels)",
  "support.note":
    "Les liens s'ouvrent dans ton navigateur. Toutes les fonctionnalités de Vaultly restent gratuites, pour toujours.",
  // --- Guided tour ---
  "tour.nav.title": "Navigue partout",
  "tour.nav.desc":
    "Bibliothèque, Importer, Stats, Corbeille et Réglages sont juste ici, sous la barre de titre.",
  "tour.add.title": "Ajoute en un clic",
  "tour.add.desc":
    "Colle une URL : Vaultly devine le type et remplit titre, description, icône et tags tout seul.",
  "tour.search.title": "Retrouve instantanément",
  "tour.search.desc":
    "Recherche plein texte (raccourci « / »). Et Ctrl+K — ou Ctrl+Alt+Espace n'importe où dans Windows — ouvre la palette.",
  "tour.view.title": "Tuiles, liste ou tableau",
  "tour.view.desc":
    "Bascule l'affichage : grille de tuiles, liste dense, ou tableau façon kanban trié par statut.",
  "tour.filters.title": "Filtre comme tu veux",
  "tour.filters.desc":
    "Par type, tag ou statut. Le sablier « À revisiter » fait ressortir ce que tu n'as plus ouvert depuis longtemps.",
  "tour.shortcuts.title": "Aide & fenêtre",
  "tour.shortcuts.desc":
    "Le bouton « ? » liste tous les raccourcis. Fermer la fenêtre la masque dans la barre des tâches : la palette la fait resurgir.",
  "tour.settings.title": "À toi de jouer",
  "tour.settings.desc":
    "Réglages : thème (Anime, Pro, Néon…), fond, sauvegarde cloud WebDAV, navigateur d'ouverture… et « Revoir la visite guidée ».",
  // --- SettingsView: toasts ---
  "settings.bg-applied": "Arrière-plan personnalisé appliqué",
  "settings.autostart-on": "Vaultly démarrera avec Windows",
  "settings.autostart-off": "Lancement au démarrage désactivé",
  "settings.open-prefs-saved": "Préférences d'ouverture enregistrées",
  // --- SettingsView: file dialogs ---
  "settings.choose-browser": "Choisir le navigateur",
  "settings.choose-note-app": "Choisir l'application de notes",
  "settings.choose-executable": "Choisir un exécutable…",
  "settings.export-library": "Exporter la bibliothèque",
  "settings.import-backup": "Importer une sauvegarde",
  "settings.choose-image": "Choisir une image sur ton PC",
  "settings.my-image": "Mon image…",
  // --- SettingsView: update ---
  "settings.checking": "Vérification…",
  "settings.version-available": "Version {version} disponible.",
  "settings.up-to-date": "Tu es à jour 🎉",
  "settings.check-failed":
    "Vérification impossible pour le moment — réessaie plus tard.",
  "settings.install-question": "Installer la version {version} ?",
  "settings.install-message":
    "Le téléchargement vérifié sera installé puis l'app redémarrera.",
  "settings.install": "Installer",
  "settings.install-version": "Installer la {version}",
  // --- SettingsView: MCP ---
  "settings.mcp-server": "Serveur MCP intégré",
  "settings.online-port": "En ligne · port {port}",
  "settings.offline": "Hors ligne",
  "settings.connect-ai": "Connecter un assistant IA",
  "settings.ai-desc":
    "Ajoute ce serveur à ton client MCP préféré. Le token est propre à cette machine — ne le partage pas.",
  "settings.server-offline": "Serveur hors ligne — token indisponible.",
  "settings.loading-token": "Chargement du token…",
  "settings.zcode-config": "ZCode — à coller dans ~/.zcode/cli/config.json",
  "settings.claude-command": "Claude Code — commande à exécuter",
  "settings.cursor-config": "Cursor — à coller dans ~/.cursor/mcp.json",
  "settings.mcp-token": "Token MCP (clients IA)",
  "settings.copy-token": "Copier le token",
  "settings.regenerate": "Régénérer",
  "settings.regenerated-mcp":
    "Nouveau token généré — mets à jour tes clients MCP",
  "settings.regenerated-add":
    "Nouveau token généré — recolle-le dans l'extension",
  // --- SettingsView: general ---
  "settings.global-shortcut": "Raccourci global de la palette",
  "settings.shortcut-desc":
    "Fonctionne partout dans Windows, même Vaultly réduite.",
  "settings.grid-render": "Rendu de la grille",
  "settings.grid-render-desc":
    "La bibliothèque est paginée (plus de défilement) : on choisit ici combien de rangées de tuiles tiennent sur une page. Les colonnes s'adaptent automatiquement à la largeur de la fenêtre.",
  "settings.tile-size": "Taille des tuiles",
  "settings.tile-size-desc":
    "Change la densité de la bibliothèque : plus les tuiles sont petites, plus tu en vois à l'écran. La grille reste fluide (les tuiles s'élargissent pour remplir la fenêtre).",
  "settings.autostart": "Lancement au démarrage",
  "settings.autostart-desc":
    "Vaultly reste actif dans la barre des tâches : la croix de la fenêtre masque l'app (le raccourci global la fait resurgir), et « Quitter » dans le menu de l'icône sauvegarde puis ferme.",
  "settings.auto-open-windows":
    "Ouvrir automatiquement à l'ouverture de session Windows",
  "settings.log": "Journal d'activité",
  "settings.log-desc":
    "En cas de bug, ouvre le dossier des logs et joins le fichier du jour à ton rapport.",
  "settings.open-logs": "Ouvrir le dossier des logs",
  "settings.guided-tour": "Visite guidée",
  "settings.tour-desc":
    "Revoir la présentation animée et le tour des fonctions clés de l'interface.",
  "settings.replay-tour": "Revoir la visite guidée",
  // --- SettingsView: appearance ---
  "settings.ambiance": "Style d'ambiance",
  "settings.ambiance-desc":
    "La palette de couleurs de toute l'interface — appliquée aussitôt, en mode clair comme en mode sombre.",
  "settings.typography": "Typographie",
  "settings.typography-desc":
    "La police utilisée partout dans l'interface, titres comme texte.",
  "settings.i18n-note":
    "Langue de l'interface. Appliqué immédiatement (les sous-titres avancés restent en français pour l'instant).",
  "settings.button-style": "Style des boutons",
  "settings.button-style-desc":
    "La forme et l'effet des boutons de toute l'app — l'aperçu ci-dessous suit ton choix en direct.",
  "settings.preview": "Aperçu :",
  "settings.secondary": "Secondaire",
  "settings.outline": "Contour",
  "settings.background": "Arrière-plan",
  "settings.bg-desc":
    "Un fond derrière l'interface : dégradé prêt à l'emploi ou ta propre image.",
  "settings.solid-bg": "Fond uni du style",
  "settings.default": "Défaut",
  "settings.remove": "Retirer",
  "settings.darken": "Assombrir",
  // --- SettingsView: IA ---
  "settings.open-browser": "Navigateur d'ouverture",
  "settings.open-browser-desc":
    "Quel navigateur ouvre tes liens web. « Système » = ton navigateur par défaut Windows.",
  "settings.system-default": "Système (défaut Windows)",
  "settings.note-app": "Application de notes",
  "settings.note-app-desc":
    "Sans réglage, les notes s'ouvrent dans le lecteur intégré. Avec une application, la note est exportée vers Documents\\Vaultly\\Notes à chaque ouverture — les modifications externes ne reviennent pas dans Vaultly.",
  "settings.vaultly-builtin": "Vaultly (lecteur intégré)",
  // --- SettingsView: links ---
  "settings.dead-links": "Liens morts",
  "settings.dead-links-desc":
    "Vérifie que chaque lien web de ta bibliothèque répond encore (404, 5xx, erreur réseau). Ça peut prendre quelques secondes.",
  "settings.check-links": "Vérifier les liens",
  "settings.archive": "Archiver",
  "settings.wayback-tooltip":
    "Chercher ce lien dans les archives Internet (archive.org)",
  // --- SettingsView: extension ---
  "settings.browser-extension": "Extension navigateur",
  "settings.extension-desc":
    "Ajoute la page courante en un clic depuis Brave, Chrome ou Edge.",
  "settings.extension-steps-open": "Ouvre {code}",
  "settings.extension-steps-dev":
    "Active le Mode développeur (coin haut droit)",
  "settings.extension-steps-load":
    "Clique sur Charger l'extension non empaquetée puis sélectionne le dossier extension à la racine du projet Vaultly",
  "settings.extension-steps-token":
    "Clique l'icône Vaultly dans la barre et colle le token de l'extension (ci-dessous) une seule fois",
  "settings.extension-token": "Token de l'extension",
  "settings.extension-token-desc":
    "N'autorise que l'ajout de ressources (POST /api/add). Lire, modifier, supprimer ou lancer des apps reste réservé au token MCP.",
  "settings.extension-note":
    "Vaultly doit être ouvert pour recevoir les ajouts — et copier une URL suffit : l'app propose automatiquement de l'ajouter (Ctrl+N pour ouvrir le formulaire à la main).",
  // --- SettingsView: backup ---
  "settings.backup": "Sauvegarde",
  "settings.backup-desc":
    "Exporte toute ta bibliothèque (ressources + dossiers) en JSON, ou restaure depuis une sauvegarde — les doublons d'URL sont ignorés. Une sauvegarde JSON est aussi créée automatiquement à chaque fermeture de l'app, dans Documents\\Vaultly\\Sauvegardes (les 10 dernières sont conservées).",
  "settings.export-all": "Exporter tout",
  "settings.import-backup-label": "Importer une sauvegarde",
  // --- SettingsView: update section ---
  "settings.update": "Mise à jour",
  "settings.update-desc":
    "Vérifie les nouvelles versions et les installe en un clic. Version installée : {version}",
  "settings.check": "Vérifier",
  // --- SettingsView: soutenir ---
  "settings.support-desc":
    "Vaultly est gratuit, sans publicité et sans compte. Si l'app te sert au quotidien, un don — même petit — aide à garder le projet vivant : hébergement, temps de développement, nouvelles fonctionnalités.",
  // --- SettingsView: dead link toasts ---
  "settings.all-links-alive": "Tous les liens semblent vivants 🎉",
  "settings.dead-links-found": "{count} lien(s) ne répondent plus",
  "settings.archive-found": "Archive trouvée{when} — lien copié",
  "settings.no-archive":
    "Aucune archive trouvée — demande de sauvegarde envoyée",
  // --- SettingsView: export/import toasts ---
  "settings.exported": "{count} ressource(s) exportée(s)",
  "settings.import-success":
    "{resourcesAdded} ressource(s) ajoutée(s), {duplicates} doublon(s), {foldersAdded} dossier(s){invalid}",
};

const en: Dict = {
  // --- App shell ---
  settings: "Settings",
  "nav.library": "Library",
  "nav.import": "Import",
  "nav.stats": "Stats",
  "nav.trash": "Trash",
  "nav.settings": "Settings",
  "win.minimize": "Minimize",
  "win.maximize": "Maximize",
  "win.restore": "Restore",
  "win.close": "Close",
  "win.closeHint":
    "Close hides the app to the taskbar — the palette brings it back.",
  "shortcuts.title": "Keyboard shortcuts",
  // --- Library toolbar ---
  "lib.search": "Search…  (shortcut: /)",
  "lib.sort": "Sort",
  "lib.favorites": "Favorites only",
  "lib.stale": "To revisit: not opened for 60 days",
  "lib.captures": "Show website screenshots (instead of favicons)",
  "lib.view.grid": "Tile view",
  "lib.view.list": "List view",
  "lib.view.board": "Board (kanban by status)",
  "lib.refresh": "Refresh (reloads resources and retries image loading)",
  "lib.openFolder": "Open the resources folder (Documents\\Vaultly)",
  "lib.select": "Select resources for bulk actions",
  "lib.select.exit": "Exit",
  "lib.select.select": "Select",
  "lib.cloud": "Attach a file from the cloud (WebDAV)",
  "lib.cloud.label": "From the cloud",
  "lib.tags": "Manage tags (rename, merge, delete)",
  "lib.tags.label": "Tags",
  "lib.note": "New note (Ctrl+Alt+N)",
  "lib.note.label": "Note",
  "lib.add": "Add",
  "lib.filter.type.all": "All",
  "lib.filter.tags": "Tags",
  "lib.filter.tags.all": "All tags",
  "lib.filter.status": "Status",
  "lib.filter.status.all": "All",
  "lib.filter.status.active": "Active",
  "lib.filter.status.todo": "To do",
  "lib.filter.status.archived": "Archived",
  "lib.filter.category": "Categories",
  // --- Library states ---
  "lib.empty.title": "Your library is empty",
  "lib.empty.desc":
    "Add your first resource, or import your bookmarks from the Import tab.",
  "lib.empty.add": "Add a resource",
  "lib.empty.filtered.title": "No result",
  "lib.empty.filtered.desc": "Try another search or clear the filters.",
  "lib.stale.empty.title": "Nothing to revisit 🎉",
  "lib.stale.empty.desc": "All your resources have been opened recently.",
  "lib.loadError": "Could not load your library.",
  "lib.retry": "Retry",
  "lib.cap500":
    "A very large number of results — narrow your search or add a filter to see everything.",
  "lib.refresh.done": "Refreshed",
  "lib.bulk.selected": "selected",
  "lib.bulk.selectAll": "Select all",
  "lib.bulk.deselect": "Deselect",
  "lib.bulk.archive": "Archive",
  "lib.bulk.delete": "Delete",
  "lib.archived": "Archived",
  "lib.todo": "To do",
  "lib.revisit": "to revisit",
  "lib.resources": "resource(s)",
  "lib.deleted": "moved to trash",
  // --- Sorts ---
  "sort.recent": "Recent",
  "sort.added": "Added",
  "sort.oldest": "Oldest",
  "sort.mostUsed": "Most used",
  "sort.manual": "Manual",
  "sort.title": "A→Z",
  // --- Common ---
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.next": "Next",
  "common.prev": "Previous",
  "common.finish": "Finish",
  "common.skip": "Skip",
  // --- Onboarding ---
  "onb.welcome.title": "Welcome to Vaultly",
  "onb.welcome.text":
    "Your personal hub: all your best sites, apps, files and notes, gathered as tiles.",
  "onb.organize.title": "Organize effortlessly",
  "onb.organize.text":
    "Nested folders, tags, favorites, status board. Duplicates are merged automatically.",
  "onb.ai.title": "Find it, connect your AI",
  "onb.ai.text":
    "Instant search, a palette anywhere, and your AI assistants reading your library.",
  "onb.cta": "Discover the interface",
  // --- Soutenir ---
  "support.title": "Support Vaultly",
  "support.text":
    "Vaultly is free, ad-free and account-free. If the app is useful to you, a donation — however small — helps keep the project alive: hosting, development time, new features.",
  "support.sponsors": "GitHub Sponsors",
  "support.kofi": "Ko-fi (one-time gifts)",
  "support.note":
    "Links open in your browser. Every Vaultly feature stays free, forever.",
  // --- Guided tour ---
  "tour.nav.title": "Navigate everywhere",
  "tour.nav.desc":
    "Library, Import, Stats, Trash and Settings are right here, under the title bar.",
  "tour.add.title": "Add in one click",
  "tour.add.desc":
    "Paste a URL: Vaultly guesses the type and fills in title, description, icon and tags automatically.",
  "tour.search.title": "Find instantly",
  "tour.search.desc":
    "Full-text search (shortcut: /). And Ctrl+K — or Ctrl+Alt+Space anywhere in Windows — opens the palette.",
  "tour.view.title": "Tiles, list or board",
  "tour.view.desc":
    "Switch views: tile grid, dense list, or kanban board sorted by status.",
  "tour.filters.title": "Filter your way",
  "tour.filters.desc":
    'By type, tag or status. The hourglass "To revisit" highlights resources you haven\'t opened in a while.',
  "tour.shortcuts.title": "Help & window",
  "tour.shortcuts.desc":
    'The "?" button lists all shortcuts. Closing the window hides it in the taskbar: the palette brings it back.',
  "tour.settings.title": "Your turn",
  "tour.settings.desc":
    'Settings: theme (Anime, Pro, Neon…), wallpaper, WebDAV cloud backup, opening browser… and "Replay the guided tour".',
  // --- SettingsView: toasts ---
  "settings.bg-applied": "Custom wallpaper applied",
  "settings.autostart-on": "Vaultly will start with Windows",
  "settings.autostart-off": "Startup launch disabled",
  "settings.open-prefs-saved": "Opening preferences saved",
  // --- SettingsView: file dialogs ---
  "settings.choose-browser": "Choose browser",
  "settings.choose-note-app": "Choose notes app",
  "settings.choose-executable": "Choose an executable…",
  "settings.export-library": "Export library",
  "settings.import-backup": "Import backup",
  "settings.choose-image": "Choose an image on your PC",
  "settings.my-image": "My image…",
  // --- SettingsView: update ---
  "settings.checking": "Checking…",
  "settings.version-available": "Version {version} available.",
  "settings.up-to-date": "You're up to date 🎉",
  "settings.check-failed": "Check impossible for now — try again later.",
  "settings.install-question": "Install version {version}?",
  "settings.install-message":
    "The verified download will be installed then the app restarts.",
  "settings.install": "Install",
  "settings.install-version": "Install {version}",
  // --- SettingsView: MCP ---
  "settings.mcp-server": "Built-in MCP server",
  "settings.online-port": "Online · port {port}",
  "settings.offline": "Offline",
  "settings.connect-ai": "Connect an AI assistant",
  "settings.ai-desc":
    "Add this server to your favorite MCP client. The token is specific to this machine — do not share it.",
  "settings.server-offline": "Server offline — token unavailable.",
  "settings.loading-token": "Loading token…",
  "settings.zcode-config": "ZCode — paste in ~/.zcode/cli/config.json",
  "settings.claude-command": "Claude Code — command to run",
  "settings.cursor-config": "Cursor — paste in ~/.cursor/mcp.json",
  "settings.mcp-token": "MCP token (AI clients)",
  "settings.copy-token": "Copy token",
  "settings.regenerate": "Regenerate",
  "settings.regenerated-mcp": "New token generated — update your MCP clients",
  "settings.regenerated-add": "New token generated — paste it in the extension",
  // --- SettingsView: general ---
  "settings.global-shortcut": "Global palette shortcut",
  "settings.shortcut-desc":
    "Works everywhere in Windows, even when Vaultly is minimized.",
  "settings.grid-render": "Grid rendering",
  "settings.grid-render-desc":
    "The library is paginated (less scrolling): choose here how many rows of tiles fit on a page. Columns adapt automatically to the window width.",
  "settings.tile-size": "Tile size",
  "settings.tile-size-desc":
    "Change the library density: the smaller the tiles, the more you see on screen. The grid stays fluid (tiles expand to fill the window).",
  "settings.autostart": "Startup launch",
  "settings.autostart-desc":
    "Vaultly stays active in the taskbar: clicking the cross of the window hides the app (the global shortcut brings it back), and « Quit » in the tray menu saves then closes.",
  "settings.auto-open-windows": "Open automatically at Windows sign-in",
  "settings.log": "Activity log",
  "settings.log-desc":
    "In case of a bug, open the logs folder and attach the file of the day to your report.",
  "settings.open-logs": "Open the logs folder",
  "settings.guided-tour": "Guided tour",
  "settings.tour-desc":
    "Replay the animated presentation and the tour of key functions.",
  "settings.replay-tour": "Replay the guided tour",
  // --- SettingsView: appearance ---
  "settings.ambiance": "Ambiance style",
  "settings.ambiance-desc":
    "The color palette of the entire interface — applied instantly, in light mode as in dark mode.",
  "settings.typography": "Typography",
  "settings.typography-desc":
    "The font used everywhere in the interface, titles and text alike.",
  "settings.i18n-note":
    "Interface language. Applied immediately (advanced subtitles remain in French for now).",
  "settings.button-style": "Button style",
  "settings.button-style-desc":
    "The shape and effect of buttons throughout the app — the preview below follows your choice in real time.",
  "settings.preview": "Preview:",
  "settings.secondary": "Secondary",
  "settings.outline": "Outline",
  "settings.background": "Background",
  "settings.bg-desc":
    "A background behind the interface: a ready-made gradient or your own image.",
  "settings.solid-bg": "Solid color of the style",
  "settings.default": "Default",
  "settings.remove": "Remove",
  "settings.darken": "Darken",
  // --- SettingsView: IA ---
  "settings.open-browser": "Opening browser",
  "settings.open-browser-desc":
    "Which browser opens your web links. « System » = your default Windows browser.",
  "settings.system-default": "System (Windows default)",
  "settings.note-app": "Notes app",
  "settings.note-app-desc":
    "Without a setting, notes open in the built-in reader. With an app, the note is exported to Documents\\Vaultly\\Notes on each opening — external changes do not come back into Vaultly.",
  "settings.vaultly-builtin": "Vaultly (built-in reader)",
  // --- SettingsView: links ---
  "settings.dead-links": "Dead links",
  "settings.dead-links-desc":
    "Check that each web link in your library still responds (404, 5xx, network error). It can take a few seconds.",
  "settings.check-links": "Check links",
  "settings.archive": "Archive",
  "settings.wayback-tooltip":
    "Search for this link in Internet archives (archive.org)",
  // --- SettingsView: extension ---
  "settings.browser-extension": "Browser extension",
  "settings.extension-desc":
    "Add the current page in one click from Brave, Chrome or Edge.",
  "settings.extension-steps-open":
    "Open brave://extensions (or chrome://extensions)",
  "settings.extension-steps-dev": "Enable Developer Mode (top right corner)",
  "settings.extension-steps-load":
    "Click Load unpacked extension then select the extension folder at the root of the Vaultly project",
  "settings.extension-steps-token":
    "Click the Vaultly icon in the tray and paste the extension token (below) once",
  "settings.extension-token": "Extension token",
  "settings.extension-token-desc":
    "Only allows adding resources (POST /api/add). Reading, modifying, deleting or launching apps remains reserved for the MCP token.",
  "settings.extension-note":
    "Vaultly must be open to receive additions — and copying a URL is enough: the app automatically proposes to add it (Ctrl+N to open the form manually).",
  // --- SettingsView: backup ---
  "settings.backup": "Backup",
  "settings.backup-desc":
    "Export your entire library (resources + folders) as JSON, or restore from a backup — duplicate URLs are ignored. A JSON backup is also created automatically on each app close, in Documents\\VaultlyBackups (the last 10 are kept).",
  "settings.export-all": "Export all",
  "settings.import-backup-label": "Import a backup",
  // --- SettingsView: update section ---
  "settings.update": "Update",
  "settings.update-desc":
    "Check for new versions and install in one click. Installed version: {version}",
  "settings.check": "Check",
  // --- SettingsView: soutenir ---
  "settings.support-desc":
    "Vaultly is free, ad-free and account-free. If the app is useful to you daily, a donation — however small — helps keep the project alive: hosting, development time, new features.",
  // --- SettingsView: dead link toasts ---
  "settings.all-links-alive": "All links seem alive 🎉",
  "settings.dead-links-found": "{count} link(s) no longer respond",
  "settings.archive-found": "Archive found{when} — link copied",
  "settings.no-archive": "No archive found — backup request sent",
  // --- SettingsView: export/import toasts ---
  "settings.exported": "{count} resource(s) exported",
  "settings.import-success":
    "{resourcesAdded} resource(s) added, {duplicates} duplicate(s), {foldersAdded} folder(s){invalid}",
};

function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = lang === "en" ? en : fr;
  const v = dict[key];
  if (v !== undefined) {
    if (params) {
      return v.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
    }
    return v;
  }
  return key;
}

export function useI18n(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, setLang, t: (key: string) => translate(lang, key) };
}
