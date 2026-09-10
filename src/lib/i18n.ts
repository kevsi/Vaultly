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
};

const en: Dict = {
  // --- App shell ---
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
};

function translate(lang: Lang, key: string): string {
  const dict = lang === "en" ? en : fr;
  const v = dict[key];
  if (v !== undefined) return v;
  // clé absente du dictionnaire → retourner la clé (lisible en FR ou EN)
  return key;
}

export function useI18n(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, setLang, t: (key: string) => translate(lang, key) };
}
