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
  "settings.extension-token": "Extension token",
  "Clique l'icône Vaultly dans la barre et colle le":
    "Click the Vaultly icon in the bar and paste the",
  "Soutenir Vaultly": "Support Vaultly",
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

  // --- conversion complète (clés = texte français) ---
  "Ouverture impossible : {error}": "Could not open: {error}",
  "URL copiée": "URL copied",
  "Copie impossible": "Could not copy",
  "Rappel effacé": "Reminder cleared",
  "Rappel enregistré — bonne lecture": "Reminder set — enjoy your reading",
  "Donne un nom à la liste (ex. Design)": "Give the list a name (e.g. Design)",
  "Lien ajouté à « {name} » ({count} lien(s))":
    'Link added to "{name}" ({count} link(s))',
  "Ce lien est déjà dans « {name} »": 'This link is already in "{name}"',
  "\nSans lien — clic pour en ajouter un": "\nNo link — click to add one",
  "À traiter": "To do",
  Archivé: "Archived",
  "Ajoutée il y a plus de 2 mois, jamais ouverte":
    "Added more than 2 months ago, never opened",
  "à revisiter": "to revisit",
  "Rappel programmé — s'efface à l'ouverture": "Reminder set — clears on open",
  Options: "Options",
  "Ouvrir la note": "Open note",
  Modifier: "Edit",
  "Ajouter un lien…": "Add a link…",
  Ouvrir: "Open",
  Détails: "Details",
  "Copier l'URL": "Copy URL",
  "Ajoute ce lien à un fichier JSON sur ton cloud (WebDAV)":
    "Add this link to a JSON file on your cloud (WebDAV)",
  "Partager vers le cloud": "Share to cloud",
  "Envoyer vers le cloud": "Send to cloud",
  "Retirer des favoris": "Remove from favorites",
  "Ajouter aux favoris": "Add to favorites",
  "Marquer à traiter": "Mark as to do",
  "Me rappeler…": "Remind me…",
  Demain: "Tomorrow",
  "Dans 3 jours": "In 3 days",
  "Dans 1 semaine": "In 1 week",
  "Effacer le rappel ({date})": "Clear reminder ({date})",
  Archiver: "Archive",
  Réactiver: "Reactivate",
  "Déplacer vers…": "Move to…",
  "Sortir du dossier": "Remove from folder",
  Supprimer: "Delete",
  "Le lien sera enregistré dans un fichier JSON de ton dossier WebDAV. Choisis une liste existante ou crées-en une nouvelle (ex. Design, AIAPI).":
    "The link will be saved in a JSON file in your WebDAV folder. Choose an existing list or create a new one (e.g. Design, AIAPI).",
  "Liste de destination": "Destination list",
  "Choisir…": "Choose…",
  "{title} ({count} lien(s))": "{title} ({count} link(s))",
  "+ Nouvelle liste…": "+ New list…",
  "Nom de la nouvelle liste": "New list name",
  Annuler: "Cancel",
  Partager: "Share",
  "{name} — {count} ressource(s)": "{name} — {count} resource(s)",
  "{count} ressource(s)": "{count} resource(s)",
  "Options du dossier": "Folder options",
  "Ouvrir le dossier": "Open folder",
  Renommer: "Rename",
  "Retire le dossier mais garde ses ressources (elles reviennent dans la grille)":
    "Removes the folder but keeps its resources (they return to the grid)",
  Dissoudre: "Dissolve",
  "Choisir une icône": "Choose an icon",
  Images: "Images",
  "Icône personnalisée appliquée": "Custom icon applied",
  "Choisir l'exécutable": "Choose the executable",
  Exécutable: "Executable",
  "Tous les fichiers": "All files",
  "Choisir un fichier": "Choose a file",
  "Saisis d'abord un lien web": "Enter a web link first",
  "Fiche du dépôt récupérée depuis GitHub":
    "Repository details fetched from GitHub",
  "Infos récupérées automatiquement": "Details fetched automatically",
  "Ressource mise à jour": "Resource updated",
  "Ressource ajoutée": "Resource added",
  "Changer de type de ressource": "Change resource type",
  "Modifier la ressource": "Edit resource",
  "Nouvelle ressource": "New resource",
  "Que veux-tu ajouter ? Choisis un type pour continuer.":
    "What do you want to add? Pick a type to continue.",
  "Parcourir…": "Browse…",
  "Récupérer le titre et le favicon automatiquement":
    "Fetch the title and favicon automatically",
  Récupérer: "Fetch",
  "Déjà enregistré sur {host} :": "Already saved on {host}:",
  "Cette URL est déjà dans ta bibliothèque":
    "This URL is already in your library",
  "Voir la ressource": "View resource",
  "Récupérer le titre et le favicon depuis le site":
    "Fetch the title and favicon from the website",
  "Icône…": "Icon…",
  "Choisir parmi des milliers d'icônes : logos d'apps et icônes génériques":
    "Choose from thousands of icons: app logos and generic icons",
  "Bibliothèque…": "Library…",
  "Retirer l'icône personnalisée": "Remove the custom icon",
  Réinitialiser: "Reset",
  "Utiliser le favicon du site (clic = appliquer)":
    "Use the site favicon (click = apply)",
  "Titre *": "Title *",
  "Tags (virgules)": "Tags (comma-separated)",
  "design, gratuit, ia": "design, free, ai",
  "{label} — détails": "{label} — details",
  Description: "Description",
  "Une phrase pour t'en souvenir": "A sentence to remember it by",
  Favori: "Favorite",
  Enregistrer: "Save",
  Ajouter: "Add",
  "Icône appliquée": "Icon applied",
  "Page web à garder": "Web page to keep",
  "Logiciel à lancer": "Software to launch",
  "GitHub, GitLab…": "GitHub, GitLab…",
  "Service en ligne": "Online service",
  "À lire, doc…": "To read, docs…",
  "YouTube, Twitch…": "YouTube, Twitch…",
  "Fichier du PC": "File from your PC",
  "Tout le reste": "Everything else",
  Sites: "Sites",
  Apps: "Apps",
  Repositories: "Repositories",
  Outils: "Tools",
  Articles: "Articles",
  Vidéos: "Videos",
  Notes: "Notes",
  Fichiers: "Files",
  Autres: "Others",
  "Ce lien est obligatoire.": "This link is required.",
  "Le lien doit commencer par http:// ou https://":
    "The link must start with http:// or https://",
  "Chemin de l'exécutable": "Executable path",
  "ex : C:\\Program Files\\Mon App\\monapp.exe":
    "e.g. C:\\Program Files\\My App\\myapp.exe",
  "Site web de l'app (optionnel)": "App website (optional)",
  "C'est le programme que la tuile lancera au clic.":
    "This is the program the tile will launch on click.",
  "Lien du dépôt": "Repository link",
  "https://github.com/owner/repo": "https://github.com/owner/repo",
  "GitHub : « Récupérer » remplit la fiche (langage, étoiles, licence…). GitLab, Bitbucket ou Codeberg acceptés.":
    'GitHub: "Fetch" fills in the details (language, stars, license…). GitLab, Bitbucket or Codeberg also work.',
  "Utilise un lien GitHub, GitLab, Bitbucket ou Codeberg.":
    "Use a GitHub, GitLab, Bitbucket or Codeberg link.",
  "Lien de la vidéo": "Video link",
  "https://youtube.com/watch?v=…": "https://youtube.com/watch?v=…",
  "YouTube, Vimeo, Dailymotion ou Twitch.":
    "YouTube, Vimeo, Dailymotion or Twitch.",
  "Utilise un lien YouTube, Vimeo, Dailymotion ou Twitch.":
    "Use a YouTube, Vimeo, Dailymotion or Twitch link.",
  "Lien de l'outil": "Tool link",
  "https://…": "https://…",
  "Un outil en ligne : son adresse web.": "An online tool: its web address.",
  "Lien de l'article": "Article link",
  "Article, documentation ou page à relire.":
    "Article, documentation or page to read.",
  Lien: "Link",
  "Tout autre type de ressource avec une adresse web.":
    "Any other type of resource with a web address.",
  "Chemin du fichier": "File path",
  "ex : C:\\Users\\moi\\Documents\\rapport.pdf":
    "e.g. C:\\Users\\me\\Documents\\report.pdf",
  "Le fichier s'ouvrira avec l'application Windows par défaut.":
    "The file will open with the default Windows app.",
  "URL du site": "Website URL",
  Plateforme: "Platform",
  "Windows, macOS, Linux, web…": "Windows, macOS, Linux, web…",
  "Version installée": "Installed version",
  "ex : 2.1.0": "e.g. 2.1.0",
  Éditeur: "Publisher",
  "nom de l'éditeur": "publisher name",
  Langage: "Language",
  "Rust, TypeScript…": "Rust, TypeScript…",
  Propriétaire: "Owner",
  "ex : vitejs": "e.g. vitejs",
  Étoiles: "Stars",
  "nombre d'étoiles": "number of stars",
  Licence: "License",
  "MIT, Apache-2.0…": "MIT, Apache-2.0…",
  Sujets: "Topics",
  "sujets séparés par des virgules": "topics separated by commas",
  "Cas d'usage": "Use case",
  "ex : retouche photo": "e.g. photo editing",
  Tarif: "Pricing",
  "gratuit, freemium, abonnement…": "free, freemium, subscription…",
  Auteur: "Author",
  "nom de l'auteur": "author name",
  "Statut de lecture": "Reading status",
  "à lire, en cours, lu": "to read, in progress, read",
  Chaîne: "Channel",
  "nom de la chaîne": "channel name",
  Durée: "Duration",
  "ex : 12:34": "e.g. 12:34",
  Statut: "Status",
  "à regarder, vue": "to watch, watched",
  "À quoi ça sert": "What it's for",
  "une phrase pour t'en souvenir": "a sentence to remember it by",
  Copié: "Copied",
  Copier: "Copy",
  Apparence: "Appearance",
  "Assistants IA": "AI assistants",
  Extension: "Extension",
  "Liens morts": "Dead links",
  Général: "General",
  Ouverture: "Opening",
  Sauvegarde: "Backup",
  "Mise à jour": "Update",
  Soutenir: "Support",
  "La palette de couleurs de toute l'interface — appliquée aussitôt, en mode clair comme en mode sombre.":
    "The color palette of the entire interface — applied instantly, in light mode as in dark mode.",
  Carnet: "Notebook",
  "Chaud & doux, le style d'origine": "Warm & soft, the original style",
  Pro: "Pro",
  "Sobre & net, bleu corporate": "Clean & sharp, corporate blue",
  Anime: "Anime",
  "Manga : rose vif, ciel & nuit violette":
    "Manga: vivid pink, sky & violet night",
  Néon: "Neon",
  "Cyberpunk : cyan électrique & magenta": "Cyberpunk: electric cyan & magenta",
  Forêt: "Forest",
  "Vert nature, calme & apaisant": "Natural green, calm & soothing",
  "Langue de l'interface. Appliqué immédiatement (les sous-titres avancés restent en français pour l'instant).":
    "Interface language. Applied immediately (advanced subtitles remain in French for now).",
  "La police utilisée partout dans l'interface, titres comme texte.":
    "The font used everywhere in the interface, titles and text alike.",
  Système: "System",
  "Serif élégant": "Elegant serif",
  "Mono / code": "Mono / code",
  Techno: "Techno",
  "BD / fun": "Comic / fun",
  "Aperçu : classez et retrouvez tout ce que vous aimez.":
    "Preview: sort and find everything you love.",
  "Taille :": "Size:",
  Compact: "Compact",
  Normal: "Normal",
  Confort: "Comfort",
  Grand: "Large",
  "La forme et l'effet des boutons de toute l'app — l'aperçu ci-dessous suit ton choix en direct.":
    "The shape and effect of buttons throughout the app — the preview below follows your choice in real time.",
  "Par défaut": "Default",
  "Doux et arrondi, suit le style": "Soft and rounded, follows the style",
  Pilule: "Pill",
  "Entièrement arrondis": "Fully rounded",
  Nets: "Sharp",
  "Angles droits, épurés": "Square corners, minimal",
  "Contours épais + ombre décalée": "Thick outlines + offset shadow",
  "Lueur colorée autour des boutons": "Colored glow around the buttons",
  "Un fond derrière l'interface : dégradé prêt à l'emploi ou ta propre image.":
    "A background behind the interface: a ready-made gradient or your own image.",
  Défaut: "Default",
  Sakura: "Sakura",
  Océan: "Ocean",
  Crépuscule: "Dusk",
  "Choisir une image sur ton PC": "Choose an image on your PC",
  "Arrière-plan personnalisé": "Custom background",
  Retirer: "Remove",
  "Tant que Vaultly est ouvert, toute IA compatible MCP peut rechercher, consulter et enrichir tes ressources via ce serveur local. Les requêtes distantes exigent le token ci-dessous.":
    "As long as Vaultly is open, any MCP-compatible AI can search, read and enrich your resources through this local server. Remote requests require the token below.",
  "Ajoute ce serveur à ton client MCP préféré. Le token est propre à cette machine — ne le partage pas.":
    "Add this server to your favorite MCP client. The token is specific to this machine — do not share it.",
  "Token MCP (clients IA)": "MCP token (AI clients)",
  "Copier le token": "Copy token",
  Régénérer: "Regenerate",
  "Régénérer le token MCP ?": "Regenerate the MCP token?",
  "Les clients IA déjà configurés devront être mis à jour. Le token de l'extension n'est pas affecté.":
    "AI clients already configured will need to be updated. The extension token is not affected.",
  "Régénérer le token de l'extension ?": "Regenerate the extension token?",
  "Il faudra recoller le nouveau token dans le popup de l'extension navigateur.":
    "You will need to re-paste the new token into the browser extension popup.",
  "Installation impossible : {error} (clé de signature manquante ?)":
    "Installation failed: {error} (missing signature key?)",
  "Raccourci global de la palette": "Global palette shortcut",
  "Raccourci : {shortcut}": "Shortcut: {shortcut}",
  "La bibliothèque est paginée (plus de défilement) : on choisit ici combien de rangées de tuiles tiennent sur une page. Les colonnes s'adaptent automatiquement à la largeur de la fenêtre.":
    "The library is paginated (less scrolling): choose here how many rows of tiles fit on a page. Columns adapt automatically to the window width.",
  "2 rangées par page": "2 rows per page",
  "grandes tuiles, peu par écran": "large tiles, few per screen",
  "3 rangées par page": "3 rows per page",
  "recommandé : équilibre taille / densité":
    "recommended: size / density balance",
  "4 rangées par page": "4 rows per page",
  "tuiles plus petites, davantage par page": "smaller tiles, more per page",
  "Change la densité de la bibliothèque : plus les tuiles sont petites, plus tu en vois à l'écran. La grille reste fluide (les tuiles s'élargissent pour remplir la fenêtre).":
    "Change the library density: the smaller the tiles, the more you see on screen. The grid stays fluid (tiles expand to fill the window).",
  "Vaultly reste actif dans la barre des tâches : la croix de la fenêtre masque l'app (le raccourci global la fait resurgir), et « Quitter » dans le menu de l'icône sauvegarde puis ferme.":
    'Vaultly stays active in the taskbar: the window close button hides the app (the global shortcut brings it back), and "Quit" in the tray icon menu saves then closes.',
  "En cas de bug, ouvre le dossier des logs et joins le fichier du jour à ton rapport.":
    "In case of a bug, open the logs folder and attach the file of the day to your report.",
  "Ouvrir le dossier des logs": "Open the logs folder",
  "Revoir la présentation animée et le tour des fonctions clés de l'interface.":
    "Replay the animated presentation and the tour of key interface features.",
  "Revoir la visite guidée": "Replay the guided tour",
  "Quel navigateur ouvre tes liens web. « Système » = ton navigateur par défaut Windows.":
    'Which browser opens your web links. "System" = your default Windows browser.',
  "Choisir un exécutable…": "Choose an executable…",
  "Sans réglage, les notes s'ouvrent dans le lecteur intégré. Avec une application, la note est exportée vers Documents\\Vaultly\\Notes à chaque ouverture — les modifications externes ne reviennent pas dans Vaultly.":
    "Without a setting, notes open in the built-in reader. With an app, the note is exported to Documents\\Vaultly\\Notes on each opening — external changes do not come back into Vaultly.",
  "Vérifie que chaque lien web de ta bibliothèque répond encore (404, 5xx, erreur réseau). Ça peut prendre quelques secondes.":
    "Check that each web link in your library still responds (404, 5xx, network error). It can take a few seconds.",
  "Ajoute la page courante en un clic depuis Brave, Chrome ou Edge.":
    "Add the current page in one click from Brave, Chrome or Edge.",
  Ouvre: "Open",
  ou: "or",
  Clique: "Click",
  "Charger l'extension non empaquetée": "Load unpacked extension",
  "puis sélectionne le dossier": "then select the folder",
  "à la racine du projet Vaultly": "at the root of the Vaultly project",
  "token de l'extension": "extension token",
  "(ci-dessous) une seule fois": "(below) once",
  "Vaultly doit être ouvert pour recevoir les ajouts — et copier une URL suffit : l'app propose automatiquement de l'ajouter (Ctrl+N pour ouvrir le formulaire à la main).":
    "Vaultly must be open to receive additions — copying a URL is enough: the app automatically offers to add it (Ctrl+N to open the form manually).",
  "Vaultly est gratuit, sans publicité et sans compte. Si l'app te sert au quotidien, un don — même petit — aide à garder le projet vivant : hébergement, temps de développement, nouvelles fonctionnalités.":
    "Vaultly is free, ad-free and account-free. If the app is useful to you daily, a donation — however small — helps keep the project alive: hosting, development time, new features.",
  "Ko-fi (dons ponctuels)": "Ko-fi (one-time gifts)",
  "Les liens s'ouvrent dans ton navigateur. Toutes les fonctionnalités de Vaultly restent gratuites, pour toujours.":
    "Links open in your browser. Every Vaultly feature stays free, forever.",
  "{resourcesAdded} ressource(s) ajoutée(s), {duplicates} doublon(s), {foldersAdded} dossier(s){invalid}":
    "{resourcesAdded} resource(s) added, {duplicates} duplicate(s), {foldersAdded} folder(s){invalid}",
  " · {invalid} entrée(s) invalide(s) ignorée(s)":
    " · {invalid} invalid entr(y/ies) ignored",
  "Raccourcis clavier": "Keyboard shortcuts",
  Retrouver: "Find",
  Organiser: "Organize",
  "Nouvelle note": "New note",
  "Palette de commandes": "Command palette",
  "Palette globale (configurable en Réglages)":
    "Global palette (configurable in Settings)",
  "Aller à la recherche": "Go to search",
  "Fermer / sortir du dossier": "Close / exit folder",
  "Déplacer la tuile (tri manuel)": "Move tile (manual sorting)",
  Échap: "Esc",
  Espace: "Space",
  Maj: "Shift",
  "Astuce : dépose une tuile au centre d'une autre pour créer un dossier, ou colle une URL n'importe où pour l'ajouter.":
    "Tip: drop a tile onto the center of another to create a folder, or paste a URL anywhere to add it.",
  "Aperçu :": "Preview:",
  Action: "Action",
  "Dossier « {name} » créé": 'Folder "{name}" created',
  "Renomme-le depuis son menu ⋯ si besoin.":
    "Rename it from its ⋯ menu if needed.",
  "Déplacé dans « {name} »": 'Moved to "{name}"',
  "Rangée dans « {name} »": 'Filed in "{name}"',
  "Sortie du dossier": "Out of the folder",
  "Ce fichier n'a pas de chemin local enregistré":
    "This file has no local path registered",
  "Envoi vers le cloud en cours…": "Uploading to the cloud…",
  "Envoyé vers le cloud sous « {name} »": 'Sent to cloud as "{name}"',
  "« {name} » joint à la bibliothèque": '"{name}" attached to library',
  "Supprimer {count} ressource(s) ?": "Delete {count} resource(s)?",
  "Elles seront restaurables 30 jours dans la corbeille (Réglages).":
    "They can be restored for 30 days from the trash (Settings).",
  "{count} ressource(s) déplacée(s) dans la corbeille":
    "{count} resource(s) moved to trash",
  "{count} ressource(s) archivée(s)": "{count} resource(s) archived",
  Archivée: "Archived",
  "Marquée à traiter": "Marked as to do",
  Réactivée: "Reactivated",
  "Supprimer « {name} » ?": 'Delete "{name}"?',
  "Elle sera restaurable 30 jours dans la corbeille (Réglages).":
    "It can be restored for 30 days from the trash (Settings).",
  "Déplacée dans la corbeille": "Moved to trash",
  "Donne un nom au dossier": "Give the folder a name",
  "Dossier renommé": "Folder renamed",
  "Supprimer le dossier « {name} » ?": 'Delete folder "{name}"?',
  "Les ressources qu'il contient ressortiront dans la grille.":
    "Its resources will reappear in the grid.",
  "Dossier supprimé": "Folder deleted",
  "Dissoudre le dossier « {name} » ?": 'Dissolve folder "{name}"?',
  "Ses ressources reviennent dans la grille et ses sous-dossiers remontent d'un niveau. Rien n'est supprimé.":
    "Its resources return to the grid and its subfolders go up one level. Nothing is deleted.",
  "Dossier « {name} » dissous": 'Folder "{name}" dissolved',
  "Dossier de ressources ouvert": "Resources folder opened",
  Tout: "All",
  Tags: "Tags",
  "Tous les tags": "All tags",
  Archivés: "Archived",
  Actifs: "Active",
  Tous: "All",
  "Dossier précédent": "Previous folder",
  Racine: "Root",
  Retour: "Back",
  "Aller à « {name} »": 'Go to "{name}"',
  "Glisse une tuile : un trait entre deux cartes les réordonne — lâche au centre d'une carte pour créer un dossier avec les deux — pose sur un dossier pour la ranger dedans. Au clavier : Ctrl+Maj+←/→ déplace la tuile sélectionnée.":
    "Drag a tile: a line between two cards reorders them — drop in the middle of a card to create a folder with both — hover a folder to file it there. Keyboard: Ctrl+Shift+←/→ moves the selected tile.",
  "Un très grand nombre de résultats — précise ta recherche ou ajoute un filtre pour tout voir.":
    "A very large number of results — narrow your search or add a filter to see everything.",
  "Joindre depuis le cloud": "Attach from the cloud",
  "Filtrer par nom de fichier…": "Filter by file name…",
  Lister: "List",
  "Lecture du dossier cloud…": "Reading the cloud folder…",
  "Aucun fichier trouvé pour « {name} ».": 'No file found for "{name}".',
  "Aucun fichier envoyé pour l'instant — envoie-en un depuis le menu ⋯ d'une tuile fichier.":
    "No file uploaded yet — send one from the ⋯ menu of a file tile.",
  "Télécharger et joindre ce fichier comme ressource locale":
    "Download and attach this file as a local resource",
  Joindre: "Attach",
  "Choisis le fichier à rapatrier dans Documents\\Vaultly\\Fichiers — il sera joint comme ressource locale, lisible hors connexion.":
    "Choose the file to bring back into Documents\\Vaultly\\Fichiers — it will be attached as a local resource, readable offline.",
  Fermer: "Close",
  "Renommer le dossier": "Rename folder",
  "Nouveau dossier": "New folder",
  "Nom du dossier": "Folder name",
  "En cours": "In progress",
  Fait: "Done",
  "Dépose une carte ici": "Drop a card here",
  "Colonne précédente": "Previous column",
  "Colonne suivante": "Next column",
  Jamais: "Never",
  "Connecté ✓ — {count} sauvegarde(s) déjà présente(s)":
    "Connected ✓ — {count} backup(s) already present",
  "Connecté ✓ — le dossier est vide": "Connected ✓ — the folder is empty",
  "Configuration WebDAV effacée": "WebDAV configuration cleared",
  "Sauvegardé sur le cloud : {name}": "Backed up to the cloud: {name}",
  "{count} ressource(s) restaurée(s), {count2} doublon(s) ignoré(s)":
    "{count} resource(s) restored, {count2} duplicate(s) skipped",
  "Sauvegarde cloud (WebDAV)": "Cloud backup (WebDAV)",
  "Envoie tes sauvegardes sur Koofr (2 Go gratuits), Nextcloud, Synology… Trois champs, pas de compte développeur à créer : l'URL d'un dossier WebDAV, un identifiant, un mot de passe. Les 5 sauvegardes les plus récentes sont conservées en ligne.":
    "Send your backups to Koofr (2 GB free), Nextcloud, Synology… Three fields, no developer account to create: the URL of a WebDAV folder, a username, a password. The 5 most recent backups are kept online.",
  Configuré: "Configured",
  "Non configuré": "Not configured",
  "URL WebDAV — ex : https://app.koofr.net/dav/Koofr/Vaultly":
    "WebDAV URL — e.g. https://app.koofr.net/dav/Koofr/Vaultly",
  "URL en": "A URL starting with",
  "vers un serveur distant : ton identifiant et ton mot de passe circulent":
    "to a remote server sends your username and your password",
  "non chiffrés": "unencrypted",
  "Privilégie une URL": "Prefer an",
  "(excepté pour un NAS en réseau local).":
    "(except for a NAS on a local network).",
  Identifiant: "Username",
  "Mot de passe — vide pour conserver l'actuel":
    "Password — leave empty to keep the current one",
  "Mot de passe (ou token d'application)": "Password (or app token)",
  "Enregistrer et tester": "Save and test",
  "Effacer la configuration": "Clear configuration",
  "Ton mot de passe est chiffré et reste sur cette machine. Sur Nextcloud, utilise un token de « Paramètres → Applis → DAV » plutôt que ton mot de passe si l'authentification à deux facteurs est active.":
    'Your password is encrypted and stays on this machine. On Nextcloud, use a token from "Settings → Apps → DAV" instead of your password if two-factor authentication is enabled.',
  "Sauvegarder maintenant": "Back up now",
  "Restaurer la dernière": "Restore the latest",
  "Sauvegarde automatique toutes les": "Automatic backup every",
  heures: "hours",
  "Dernière sauvegarde cloud :": "Last cloud backup:",
  "« {title} » restaurée": '"{title}" restored',
  "{count} ressource(s) restaurée(s) ({count2} déjà disparue(s))":
    "{count} resource(s) restored ({count2} already gone)",
  "{count} ressource(s) restaurée(s)": "{count} resource(s) restored",
  "Vider la corbeille ({count} entrée(s)) ?": "Empty trash ({count} item(s))?",
  "Ces ressources seront définitivement perdues.":
    "These resources will be permanently lost.",
  Vider: "Empty",
  "Corbeille vidée ({count})": "Trash emptied ({count})",
  Corbeille: "Trash",
  "{count} entrée(s)": "{count} item(s)",
  "Tout désélectionner": "Deselect all",
  "Tout sélectionner": "Select all",
  "Vider la corbeille": "Empty trash",
  "Lecture de la corbeille…": "Loading trash…",
  "La corbeille est vide": "The trash is empty",
  "Les ressources supprimées de la bibliothèque apparaîtront ici pendant 30 jours — restaurables d'un clic.":
    "Resources deleted from the library will appear here for 30 days — restorable with one click.",
  "Sélectionner « {title} »": 'Select "{title}"',
  "supprimée le {date}": "deleted on {date}",
  "Remettre cette ressource dans la bibliothèque":
    "Put this resource back in the library",
  Restaurer: "Restore",
  "{count} sélectionnée(s)": "{count} selected",
  "Restaurer la sélection": "Restore selection",
  "{month} : {count} ajout(s)": "{month}: {count} added",
  "janv.": "Jan",
  "févr.": "Feb",
  mars: "Mar",
  "avr.": "Apr",
  mai: "May",
  juin: "Jun",
  "juil.": "Jul",
  août: "Aug",
  "sept.": "Sep",
  "oct.": "Oct",
  "nov.": "Nov",
  "déc.": "Dec",
  "Chargement des statistiques…": "Loading statistics…",
  "Impossible de charger les statistiques": "Could not load statistics",
  "erreur inconnue": "unknown error",
  Ressources: "Resources",
  Favoris: "Favorites",
  "Jamais ouvertes": "Never opened",
  Statistiques: "Statistics",
  "Ta bibliothèque en un coup d'œil.": "Your library at a glance.",
  "Activité — 12 derniers mois": "Activity — last 12 months",
  "Par type": "By type",
  "Par tag": "By tag",
  "Ajoute des tags à tes ressources pour voir la répartition.":
    "Add tags to your resources to see the breakdown.",
  "Top utilisation": "Most used",
  "{count} ouverture(s)": "opened {count} time(s)",
  "Ouvre des ressources pour voir le classement apparaître.":
    "Open some resources to see the ranking appear.",
  "Oubliées — jamais ouvertes": "Forgotten — never opened",
  "Les plus anciennes d'abord : passe les revoir ou nettoie.":
    "Oldest first: go review them or clean up.",
  "Toutes tes ressources ont été ouvertes au moins une fois. 🎉":
    "All your resources have been opened at least once. 🎉",
  "Astuce : clique des tuiles pour faire monter les compteurs, et renseigne le statut des articles/vidéos pour suivre ta progression.":
    "Tip: click tiles to bump the counters, and set the status of articles/videos to track your progress.",
  "Écris ta note…": "Write your note…",
  "Annuler (Ctrl+Z)": "Undo (Ctrl+Z)",
  "Rétablir (Ctrl+Y)": "Redo (Ctrl+Y)",
  "Gras (Ctrl+B)": "Bold (Ctrl+B)",
  "Italique (Ctrl+I)": "Italic (Ctrl+I)",
  "Souligné (Ctrl+U)": "Underline (Ctrl+U)",
  Barré: "Strikethrough",
  Titre: "Heading",
  "Liste à puces": "Bulleted list",
  "Liste numérotée": "Numbered list",
  Citation: "Quote",
  "Effacer la mise en forme": "Clear formatting",
  "Contenu de la note": "Note content",
  "{count} mot(s) · {chars} caractère(s)":
    "{count} word(s) · {chars} character(s)",
  "· lecture ~{count} min": "· ~{count} min read",
  "Ctrl+B gras · Ctrl+I italique · Ctrl+U souligné · listes et citation via la barre":
    "Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · lists and quotes via the toolbar",
  "Adresse du lien": "Link address",
  "Colle l'URL de destination (https://…)":
    "Paste the destination URL (https://…)",
  "Insérer le lien": "Insert link",
  "Ajouté à la bibliothèque ✓": "Added to your library ✓",
  "Déjà dans ta bibliothèque": "Already in your library",
  "Rechercher une ressource — ou coller une URL à ajouter…":
    "Search a resource — or paste a URL to add…",
  "Aucun résultat": "No results",
  "Tape pour rechercher": "Type to search",
  "Ajouter « {host} » à la bibliothèque": 'Add "{host}" to your library',
  "Donne un titre ou un contenu à la note":
    "Give the note a title or some content",
  "Note mise à jour": "Note updated",
  "Note créée": "Note created",
  "Modifier la note": "Edit note",
  "Titre de la note": "Note title",
  Contenu: "Content",
  "ex : design, gratuit, ia — séparés par des virgules":
    "e.g. design, free, ai — comma-separated",
  "Ajouter #{tag}": "Add #{tag}",
  "Astuce : sépare par des virgules. Clique un tag suggéré pour l'ajouter.":
    "Tip: separate with commas. Click a suggested tag to add it.",
  "Couleur :": "Color:",
  "Créer la note": "Create note",
  "Note déplacée dans la corbeille": "Note moved to the trash",
  "Ouvert dans {app}": "Opened in {app}",
  "Le {date}": "On {date}",
  "(note vide)": "(empty note)",
  "Retiré des favoris": "Remove from favorites",
  "La note est exportée vers Documents\\Vaultly\\Notes à chaque ouverture":
    "The note is exported to Documents\\Vaultly\\Notes on every open",
  "Ouvrir avec {app}": "Open with {app}",
  "Supprimer la note ?": "Delete note?",
  "« {title} » sera restaurable 30 jours dans la corbeille (Réglages).":
    '"{title}" will be recoverable for 30 days in the trash (Settings).',
  "Le nouveau nom ne peut pas être vide": "The new name cannot be empty",
  "Rien à renommer": "Nothing to rename",
  "« {from} » → « {to} » ({count} ressource(s))":
    '"{from}" → "{to}" ({count} resource(s))',
  "Tag « {tag} » supprimé ({count} ressource(s))":
    'Tag "{tag}" deleted ({count} resource(s))',
  "Gérer les tags": "Manage tags",
  "Renommer vers un tag existant les fusionne. La suppression retire le tag partout, sans toucher aux ressources.":
    "Renaming to an existing tag merges them. Deleting removes the tag everywhere, without touching resources.",
  "Filtrer les tags…": "Filter tags…",
  "Chargement…": "Loading…",
  "Aucun tag pour l'instant.": "No tags yet.",
  "Aucun tag pour « {filter} ».": 'No tags for "{filter}".',
  "Appliquer le nouveau nom": "Apply new name",
  "Supprimer ?": "Delete?",
  "Renommer « {name} »": 'Rename "{name}"',
  "Supprimer « {name} » partout": 'Delete "{name}" everywhere',
  "{count} tag(s) au total.": "{count} tag(s) in total.",
  "ajoutée le {date}": "added on {date}",
  "ouverte {count} fois": "opened {count} times",
  "jamais ouverte": "never opened",
  "Cliquer pour copier": "Click to copy",
  "Dépôt GitHub": "GitHub repository",
  "Interrogation de GitHub…": "Querying GitHub…",
  "Pas de README sur ce dépôt.": "No README in this repository.",
  "Détails indisponibles (quota GitHub ou dépôt privé).":
    "Details unavailable (GitHub quota or private repository).",
  "Arrière-plan trop lourd à enregistrer : choisis une image plus petite":
    "Background too large to save: choose a smaller image",
  "Le fichier choisi n'est pas une image": "The selected file is not an image",
  "Canvas indisponible dans ce navigateur":
    "Canvas unavailable in this browser",
  "Une erreur est survenue.": "An error occurred.",
  "aujourd'hui": "today",
  demain: "tomorrow",
  "dans {days} j": "in {days} d",
  "{count} lien(s) ne répondent plus — voir Réglages › Liens morts":
    "{count} link(s) no longer respond — see Settings › Dead links",
  "Mise à jour disponible : v{version}": "Update available: v{version}",
  "Rappel : « {title} »": 'Reminder: "{title}"',
  "Vaultly a rencontré une erreur": "Vaultly encountered an error",
  "Recharger l'interface": "Reload the interface",
  "Page précédente": "Previous page",
  Précédent: "Previous",
  "{count} résultat(s)": "{count} result(s)",
  "Page suivante": "Next page",
  Suivant: "Next",
  "Bibliothèque d'icônes": "Icon library",
  "{count} logos d'apps et de marques — un clic et c'est appliqué.":
    "{count} app and brand logos — one click to apply.",
  "200 000+ icônes génériques (Lucide, Material, Tabler…) — un clic et c'est appliqué.":
    "200,000+ generic icons (Lucide, Material, Tabler…) — one click to apply.",
  "Apps & marques": "Apps & brands",
  Génériques: "Generic",
  "Rechercher un logo (ex : youtube, vscode, banque…)":
    "Search a logo (e.g. youtube, vscode, bank…)",
  "Rechercher une icône (ex : musique, livre, game…)":
    "Search an icon (e.g. music, book, game…)",
  "Icône indisponible pour le moment": "Icon unavailable right now",
  "Icône indisponible": "Icon unavailable",
  "Les aperçus ne chargent pas — vérifie ta connexion Internet (les visuels viennent d'un CDN).":
    "Previews are not loading — check your Internet connection (images come from a CDN).",
  "Aucun logo pour « {query} » ici — les marques retirées de Simple Icons (Adobe, OpenAI…) restent trouvables dans Génériques.":
    'No logo for "{query}" here — brands removed from Simple Icons (Adobe, OpenAI…) can still be found in Generic.',
  "Chercher dans Génériques": "Search in Generic",
  "Recherche en cours…": "Searching…",
  "Recherche indisponible — vérifie ta connexion puis réessaie.":
    "Search unavailable — check your connection and try again.",
  "Aucune icône pour « {query} » — essaie un mot plus simple, en anglais.":
    'No icon for "{query}" — try a simpler English word.',
  "Tape un nom pour explorer les 3459 logos, 48 par page (la recherche comprend le français). Nécessite Internet (CDN Simple Icons).":
    "Type a name to explore the 3459 logos, 48 per page (search understands French). Requires Internet (Simple Icons CDN).",
  "Recherche en ligne (API Iconify, 48 par page). Nécessite Internet.":
    "Online search (Iconify API, 48 per page). Requires Internet.",
  Couleur: "Color",
  "couleurs officielles": "official colors",
  Blanc: "White",
  "lisible en thème sombre": "readable on dark theme",
  Noir: "Black",
  "lisible en thème clair": "readable on light theme",
  Sombres: "Dark",
  Claires: "Light",
  "Fichier trop lourd (10 Mo maximum)": "File too large (10 MB maximum)",
  "{count} favori(s) lu(s) depuis {file}":
    "{count} bookmark(s) read from {file}",
  "Aucun favori sélectionné": "No bookmark selected",
  "{count} favori(s) importé(s)": "{count} bookmark(s) imported",
  "Importer des favoris": "Import bookmarks",
  "Détecte les favoris de tes navigateurs, ou importe un fichier. Les doublons d'URL sont ignorés automatiquement.":
    "Detects your browser bookmarks, or import a file. Duplicate URLs are ignored automatically.",
  Redétecter: "Redetect",
  "Export « favoris HTML » de n'importe quel navigateur":
    '"HTML bookmarks" export from any browser',
  "Fichier HTML…": "HTML file…",
  "Export CSV type Pocket ou Raindrop (colonnes url, titre…)":
    "Pocket or Raindrop style CSV export (url, title… columns)",
  "Fichier CSV…": "CSV file…",
  "{name} · {count} favori(s)": "{name} · {count} bookmark(s)",
  "HTML Netscape (« Exporter les favoris ») ou CSV Pocket/Raindrop : les favoris lus s'ajoutent ci-dessous, à cocher comme les autres.":
    'Netscape HTML ("Export bookmarks") or Pocket/Raindrop CSV: read bookmarks are added below, to check like the others.',
  "Détection des navigateurs…": "Detecting browsers…",
  "Aucun favori détecté dans Brave, Chrome, Edge ou Firefox. Assure-toi que le navigateur est installé et contient des favoris — ou importe un fichier HTML/CSV ci-dessus.":
    "No bookmarks detected in Brave, Chrome, Edge or Firefox. Make sure the browser is installed and has bookmarks — or import an HTML/CSV file above.",
  "{count} favori(s)": "{count} bookmark(s)",
  "Tout décocher": "Uncheck all",
  "Tout cocher": "Check all",
  "Tags par défaut": "Default tags",
  "ex : import, a-trier": "e.g. import, to-sort",
  "Le dossier d'origine de chaque favori (ex : « Développement/React ») est aussi ajouté comme tag pour rester cherchable.":
    'Each bookmark\'s original folder (e.g. "Development/React") is also added as a tag to stay searchable.',
  "Importer la sélection": "Import selection",
  "ajouté(s) ·": "added ·",
  "doublon(s) ignoré(s)": "duplicate(s) ignored",
  " · {count} erreur(s)": " · {count} error(s)",
  Fichier: "File",
  "Recherche d'icônes indisponible": "Icon search unavailable",
  "Aucun favori trouvé dans ce fichier HTML":
    "No bookmark found in this HTML file",
  "CSV vide ou sans lignes de données": "Empty CSV or no data rows",
  "Aucun lien valide dans ce CSV": "No valid link in this CSV",
  "Options pour « {title} »": 'Options for "{title}"',
  "Nouveau sous-dossier dans « {name} »": 'New subfolder in "{name}"',
  Ressource: "Resource",
  Ouvertures: "Opens",
  dossier: "folder",
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
  // clé absente (ex : clé = texte français avec placeholders) : interpoler
  // quand même la clé elle-même pour ne pas afficher "{count}" brut.
  if (params) {
    return key.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
  }
  return key;
}

export function useI18n(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, setLang, t: (key, params) => translate(lang, key, params) };
}

/**
 * Traduction non réactive (fichiers lib hors React) : lit la langue courante
 * à l'appel. Suffisant pour les messages d'erreur et libellés statiques.
 */
export function tt(
  key: string,
  params?: Record<string, string | number>,
): string {
  return translate(getLang(), key, params);
}
