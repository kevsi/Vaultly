import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  Keyboard,
  Library,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Settings,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { FirstRun } from "@/components/FirstRun";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  checkDeadLinks,
  dueReminders,
  listTrash,
  openResourceById,
  startupNotice,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  checkForUpdates,
  markUpdateChecked,
  updateCheckDue,
} from "@/lib/updater";
import { useClipboardCapture } from "@/lib/useClipboardCapture";

// Vues chargées à la demande (code splitting) : le bundle initial ne
// contient que le shell ; chaque onglet pèse son propre chunk. La vue
// Bibliothèque, la plus utilisée, reste dans le bundle principal.
const ImportView = lazy(() =>
  import("@/components/ImportView").then((m) => ({ default: m.ImportView })),
);
const StatsView = lazy(() =>
  import("@/components/StatsView").then((m) => ({ default: m.StatsView })),
);
const TrashView = lazy(() =>
  import("@/components/TrashView").then((m) => ({ default: m.TrashView })),
);
const SettingsView = lazy(() =>
  import("@/components/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);

// Bibliothèque (vue par défaut) : lazy mais préchargée dès que le navigateur
// est inactif après le premier rendu — le chunk existe déjà quand l'œil
// arrive sur la grille.
const LibraryViewLazy = lazy(() =>
  import("@/components/LibraryView").then((m) => ({ default: m.LibraryView })),
);

const queryClient = new QueryClient();

/** Écran d'attente pendant le chargement d'un chunk de vue. */
function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

const APP_LOGO = "/logo.png?v=2";

/** Pastille du nombre d'entrées dans la corbeille (sous le QueryClient). */
function TrashCount() {
  const { data } = useQuery({
    queryKey: ["trash"],
    queryFn: listTrash,
    staleTime: 30_000,
  });
  const n = data?.length ?? 0;
  if (n === 0) return null;
  return (
    <span className="ml-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive tabular-nums">
      {n}
    </span>
  );
}

/**
 * Contrôles de fenêtre intégrés à la toolbar (fenêtre sans decorations) :
 * minimiser / maximiser-restaurer / fermer. Ce sont des boutons cliquables,
 * donc Tauri n'y déclenche jamais le drag ni le maximize au double-clic.
 * L'icône du milieu reflète l'état (agrandir ↔ restaurer) via le resize.
 */
function WindowControls() {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void win
      .isMaximized()
      .then((m) => active && setMaximized(m))
      .catch(() => {});
    void win
      .onResized(async () => {
        if (active) setMaximized(await win.isMaximized());
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [win]);

  const base =
    "flex w-11 shrink-0 items-center justify-center rounded-none text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="-mr-4 flex shrink-0 self-stretch items-stretch">
      <button
        type="button"
        aria-label={t("win.minimize")}
        title={t("win.minimize")}
        className={`${base} hover:bg-muted hover:text-foreground`}
        onClick={() => void win.minimize()}
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("win.restore") : t("win.maximize")}
        title={maximized ? t("win.restore") : t("win.maximize")}
        className={`${base} hover:bg-muted hover:text-foreground`}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <Minimize2 className="size-4" />
        ) : (
          <Maximize2 className="size-4" />
        )}
      </button>
      <button
        type="button"
        aria-label={t("win.close")}
        title={t("win.close")}
        className={`${base} hover:bg-destructive hover:text-white`}
        onClick={() => void win.close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default function App() {
  const { t } = useI18n();
  const [tab, setTab] = useState("library");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useClipboardCapture();
  // pastille « liens morts » sur l'onglet Réglages (vérif auto ci-dessous
  // ou manuelle dans Réglages › Liens morts)
  const [deadCount, setDeadCount] = useState(() => {
    try {
      const raw = localStorage.getItem("vaultly-deadlinks");
      return raw ? ((JSON.parse(raw) as { count?: number }).count ?? 0) : 0;
    } catch {
      return 0;
    }
  });

  // vérification auto des liens morts : au lancement si la dernière a plus
  // de 24 h, puis toutes les 6 h tant que l'app reste ouverte
  // biome-ignore lint/correctness/useExhaustiveDependencies: effet au montage seul — t est recréé à chaque rendu
  useEffect(() => {
    async function autoCheck() {
      try {
        const raw = localStorage.getItem("vaultly-deadlinks");
        const last = raw ? ((JSON.parse(raw) as { at?: number }).at ?? 0) : 0;
        if (Date.now() - last < 24 * 3600_000) return;
        const dead = await checkDeadLinks();
        localStorage.setItem(
          "vaultly-deadlinks",
          JSON.stringify({ at: Date.now(), count: dead.length }),
        );
        setDeadCount(dead.length);
        if (dead.length > 0) {
          toast.warning(
            t(
              "{count} lien(s) ne répondent plus — voir Réglages › Liens morts",
              {
                count: dead.length,
              },
            ),
          );
        }
      } catch {
        /* silencieux : la vérification manuelle reste disponible */
      }
    }
    void autoCheck();
    const timer = window.setInterval(() => void autoCheck(), 6 * 3600_000);
    function onChanged() {
      try {
        const raw = localStorage.getItem("vaultly-deadlinks");
        setDeadCount(
          raw ? ((JSON.parse(raw) as { count?: number }).count ?? 0) : 0,
        );
      } catch {
        setDeadCount(0);
      }
    }
    function onSeen() {
      // rubrique visitée : la pastille tombe, mais on garde la date pour
      // ne pas revérifier aussitôt (prochain passage dans 6 h)
      try {
        const raw = localStorage.getItem("vaultly-deadlinks");
        const at = raw
          ? ((JSON.parse(raw) as { at?: number }).at ?? Date.now())
          : Date.now();
        localStorage.setItem(
          "vaultly-deadlinks",
          JSON.stringify({ at, count: 0 }),
        );
      } catch {
        /* ignore */
      }
      setDeadCount(0);
    }
    window.addEventListener("vaultly:deadlinks-changed", onChanged);
    window.addEventListener("vaultly:deadlinks-seen", onSeen);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("vaultly:deadlinks-changed", onChanged);
      window.removeEventListener("vaultly:deadlinks-seen", onSeen);
    };
  }, []);

  useEffect(() => {
    // erreurs invoke non catchées remontées en toast
    const handler = (e: PromiseRejectionEvent) => {
      toast.error(String(e.reason));
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  useEffect(() => {
    // la visite guidée cible la bibliothèque : revenir dessus avant le tour
    const goLibrary = () => setTab("library");
    window.addEventListener("vaultly:go-library", goLibrary);
    return () => window.removeEventListener("vaultly:go-library", goLibrary);
  }, []);

  // préchargement du chunk Bibliothèque quand le navigateur est inactif
  useEffect(() => {
    const id = window.requestIdleCallback(
      () => void import("@/components/LibraryView"),
    );
    return () => window.cancelIdleCallback(id);
  }, []);

  // contrôle silencieux de mise à jour (1/jour max) : notifie, n'installe
  // jamais seul. Échec silencieux en dev / hors-ligne / clé manquante.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effet au montage seul — t est recréé à chaque rendu
  useEffect(() => {
    if (!updateCheckDue()) return;
    void (async () => {
      try {
        const update = await checkForUpdates();
        markUpdateChecked();
        if (update) {
          toast.info(
            t("Mise à jour disponible : v{version}", {
              version: update.version,
            }),
            {
              duration: 10_000,
              action: {
                label: "Voir",
                onClick: () => {
                  localStorage.setItem("vaultly-settings-section", "maj");
                  setTab("settings");
                },
              },
            },
          );
        }
      } catch {
        /* silencieux */
      }
    })();
  }, []);

  // rappels échus au lancement (max 3) : « Ouvrir » solde le rappel.
  // Sans application externe, une note n'a rien à ouvrir : simple rappel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effet au montage seul — t est recréé à chaque rendu
  useEffect(() => {
    void (async () => {
      try {
        const due = await dueReminders();
        for (const r of due.slice(0, 3)) {
          if (r.resourceType === "note") {
            toast.info(t("Rappel : « {title} »", { title: r.title }), {
              duration: 12_000,
            });
          } else {
            toast.info(t("Rappel : « {title} »", { title: r.title }), {
              duration: 12_000,
              action: {
                label: "Ouvrir",
                onClick: () => {
                  void openResourceById(r.id).catch((e) =>
                    toast.error(String(e)),
                  );
                },
              },
            });
          }
        }
        if (due.length > 3) {
          toast.info(`${due.length - 3} autre(s) rappel(s) en attente`);
        }
      } catch {
        /* silencieux */
      }
    })();
  }, []);

  // base restaurée après corruption (démarrage) : on prévient une fois
  useEffect(() => {
    void startupNotice()
      .then((msg) => {
        if (msg) toast.warning(msg, { duration: 15_000 });
      })
      .catch(() => {});
  }, []);

  // dragDropEnabled:false (DnD HTML5 interne) laisse aussi passer les drops
  // NATIFS : déposer un fichier depuis l'Explorateur chargerait file:///…
  // dans le WebView et ferait quitter l'app. On neutralise tout drop non
  // traité en interne (les handlers internes preventDefault avant nous).
  // Bonus : déposer une URL depuis un navigateur = capture directe, le même
  // événement que le presse-papiers (la modale d'ajout s'ouvre pré-remplie).
  // Nos drags internes mettent un id numérique ou « folder:N » : jamais un
  // http(s) complet, donc aucune ambiguïté avec un dépôt externe.
  useEffect(() => {
    const preventOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const text =
        e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain") ||
        "";
      const m = text.match(/https?:\/\/[^\s"'<>]+/i);
      if (m) {
        window.dispatchEvent(
          new CustomEvent("vaultly:add-url", { detail: m[0] }),
        );
      }
    };
    window.addEventListener("dragover", preventOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", preventOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // palette : Ctrl+Alt+Espace (global, émis par Rust) et Ctrl+K (local)
  useEffect(() => {
    const unlisten = listen("palette-toggle", () => setPaletteOpen((o) => !o));
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* fond transparent : le body porte la couleur de base ET l'arrière-plan
          personnalisé (Réglages → Apparence) */}
      <div className="flex h-screen flex-col text-foreground">
        {/* header = barre de titre personnalisée. data-tauri-drag-region="deep" :
            tout l'espace NON interactif déplace la fenêtre et, au double-clic,
            maximise/restaure (géré nativement par Tauri) ; les boutons, tabs et
            champs cliquables blockent le drag automatiquement → navigation intacte. */}
        <header
          data-tauri-drag-region="deep"
          className="flex shrink-0 select-none items-center gap-3 border-b px-4 py-2"
        >
          <div className="flex items-center gap-2">
            <img
              src={APP_LOGO}
              alt=""
              draggable={false}
              className="size-8 rounded-lg object-cover"
            />
            <span className="font-semibold">Vaultly</span>
          </div>
          <Tabs
            value={tab}
            onValueChange={setTab}
            data-tour="nav"
            className="ml-4"
          >
            <TabsList>
              <TabsTrigger value="library">
                <Library />
                {t("nav.library")}
              </TabsTrigger>
              <TabsTrigger value="import">
                <StickyNote />
                {t("nav.import")}
              </TabsTrigger>
              <TabsTrigger value="stats">
                <Activity />
                {t("nav.stats")}
              </TabsTrigger>
              <TabsTrigger value="trash">
                <Trash2 />
                {t("nav.trash")}
                <TrashCount />
              </TabsTrigger>
              <TabsTrigger value="settings" data-tour="settings">
                <Settings />
                {t("nav.settings")}
                {deadCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-600 tabular-nums">
                    {deadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="grow" />
          <Button
            variant="ghost"
            size="icon"
            data-tour="shortcuts"
            onClick={() => setShortcutsOpen(true)}
            title={t("Raccourcis clavier")}
          >
            <Keyboard />
          </Button>
          <WindowControls />
        </header>

        {/* contenu */}
        <main className="min-h-0 flex-1">
          <Suspense fallback={<ViewFallback />}>
            {tab === "library" && <LibraryViewLazy />}
            {tab === "import" && <ImportView />}
            {tab === "stats" && <StatsView />}
            {tab === "trash" && <TrashView />}
            {tab === "settings" && <SettingsView />}
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <FirstRun />
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
