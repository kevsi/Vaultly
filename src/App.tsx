import {
  Activity,
  Library,
  Loader2,
  Moon,
  Settings,
  Sun,
  Trash2,
  StickyNote,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { Onboarding } from "@/components/Onboarding";
import { listTrash } from "@/lib/api";
import { useClipboardCapture } from "@/lib/useClipboardCapture";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  import("@/components/SettingsView").then((m) => ({ default: m.SettingsView })),
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

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("vaultly-theme");
    if (stored) return stored === "dark";
    // jamais de choix manuel → on suit le thème Windows
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  });
  // la préférence système n'est écoutée TANT QUE l'utilisateur n'a pas
  // basculé manuellement au moins une fois (son choix devient la vérité)
  const userChose = useRef(!!localStorage.getItem("vaultly-theme"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    if (userChose.current) {
      localStorage.setItem("vaultly-theme", dark ? "dark" : "light");
    }
  }, [dark]);
  useEffect(() => {
    if (userChose.current) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return {
    dark,
    toggle: () => {
      userChose.current = true;
      setDark((d) => !d);
    },
  };
}

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

export default function App() {
  const [tab, setTab] = useState("library");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { dark, toggle } = useDarkMode();
  useClipboardCapture();

  useEffect(() => {
    // erreurs invoke non catchées remontées en toast
    const handler = (e: PromiseRejectionEvent) => {
      toast.error(String(e.reason));
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  // préchargement du chunk Bibliothèque quand le navigateur est inactif
  useEffect(() => {
    const id = window.requestIdleCallback(() => void import("@/components/LibraryView"));
    return () => window.cancelIdleCallback(id);
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
        window.dispatchEvent(new CustomEvent("vaultly:add-url", { detail: m[0] }));
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
    const unlisten = listen("palette-toggle", () =>
      setPaletteOpen((o) => !o),
    );
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
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* header */}
        <header className="flex items-center gap-3 border-b px-4 py-2.5">
          <div className="flex items-center gap-2">
            <img
              src={APP_LOGO}
              alt=""
              className="size-8 rounded-lg object-cover"
            />
            <span className="font-semibold">Vaultly</span>
          </div>
          <Tabs value={tab} onValueChange={setTab} className="ml-4">
            <TabsList>
              <TabsTrigger value="library">
                <Library />
                Bibliothèque
              </TabsTrigger>
              <TabsTrigger value="import">
                <StickyNote />
                Importer
              </TabsTrigger>
              <TabsTrigger value="stats">
                <Activity />
                Stats
              </TabsTrigger>
              <TabsTrigger value="trash">
                <Trash2 />
                Corbeille
                <TrashCount />
              </TabsTrigger>
              <TabsTrigger value="settings">
                <Settings />
                Réglages
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="grow" />
          <Button variant="ghost" size="icon" onClick={toggle} title="Thème clair/sombre">
            {dark ? <Sun /> : <Moon />}
          </Button>
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
      <Onboarding onTryPalette={() => setPaletteOpen(true)} />
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
