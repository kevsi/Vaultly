/**
 * i18n minimaliste maison (aucune dépendance) : dictionnaire FR/EN,
 * persistance `vaultly-lang`, hook réactif `useI18n()` via
 * useSyncExternalStore. Le français reste la langue de référence : toute clé
 * absente retombe sur le texte français d'origine côté consommateur.
 *
 * NB : la couverture progresse par vagues (shell + bibliothèque + onboarding
 * d'abord) ; les chaînes non converties restent en français.
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

function t(lang: Lang, key: string): string {
  if (lang === "en") {
    const v = en[key];
    if (v !== undefined) return v;
  }
  // français = langue de référence : la clé porte le texte FR d'origine
  // (les consommateurs passent le texte FR comme clé) ; clé absente → renvoyer
  // la clé telle quelle pour rester lisible.
  return key;
}

export function useI18n(): {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Traduit une clé ; en FR, renvoie le texte français passé. */
  t: (key: string) => string;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, setLang, t: (key: string) => t(lang, key) };
}
