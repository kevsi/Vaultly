import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  Archive,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileInput,
  FileText,
  ImagePlus,
  Link2Off,
  Loader2,
  Palette,
  Plug,
  Power,
  Puzzle,
  RefreshCw,
  Rocket,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { WebDavBackupSection } from "@/components/WebDavBackupSection";
import {
  apiRegenerateToken,
  checkDeadLinks,
  type DeadLink,
  detectOpeners,
  exportData,
  getAutostart,
  getMcpStatus,
  getOpenPrefs,
  importData,
  mcpRegenerateToken,
  openLogsFolder,
  setAutostart,
  setGlobalShortcut,
  setOpenPrefs,
  waybackAvailable,
} from "@/lib/api";
import {
  BG_GRADIENTS,
  type BgState,
  BUTTON_STYLES,
  FONT_SCALES,
  FONTS,
  type FontId,
  imageFileToDataUrl,
  STYLES,
  updateAppearance,
  useAppearance,
} from "@/lib/appearance";
import {
  getPageDensity,
  PAGE_DENSITIES,
  type PageDensity,
  setPageDensity as persistPageDensity,
} from "@/lib/gridPagination";
import {
  getTileSize,
  setTileSize as persistTileSize,
  TILE_SIZES,
  type TileSize,
} from "@/lib/tileSize";
import {
  checkForUpdates,
  currentVersion,
  installUpdate,
  markUpdateChecked,
} from "@/lib/updater";
import { suppressClipboardCapture } from "@/lib/useClipboardCapture";
import { cn, describeError } from "@/lib/utils";

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copié" : "Copier"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Nom court d'un exécutable configuré (« Code », « notepad++ »…). */
function exeBase(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.exe$/i, "");
}

/** Ligne de choix radio (navigateur / application de notes). */
function OpenerOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-primary ring-2 ring-primary/30"
          : "cursor-pointer border-border hover:bg-accent/50",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          active ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </span>
        )}
      </span>
      {active && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

// Rubriques de la page Réglages : la sidebar remplace le long scroll unique.
const SECTIONS = [
  { id: "apparence", label: "Apparence", icon: Palette },
  { id: "ia", label: "Assistants IA", icon: Plug },
  { id: "extension", label: "Extension", icon: Puzzle },
  { id: "links", label: "Liens morts", icon: Link2Off },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "ouverture", label: "Ouverture", icon: ExternalLink },
  { id: "backup", label: "Sauvegarde", icon: Save },
  { id: "maj", label: "Mise à jour", icon: Rocket },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const [section, setSection] = useState<SectionId>(() => {
    const stored = localStorage.getItem("vaultly-settings-section");
    return SECTIONS.some((s) => s.id === stored) ? (stored as SectionId) : "ia";
  });
  function pickSection(id: SectionId) {
    setSection(id);
    localStorage.setItem("vaultly-settings-section", id);
  }
  // rubrique « Liens morts » visitée : la pastille tombe (revérifiée auto
  // toutes les 6 h si les liens restent morts)
  useEffect(() => {
    if (section === "links") {
      window.dispatchEvent(new CustomEvent("vaultly:deadlinks-seen"));
    }
  }, [section]);

  const { data: status, isLoading } = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: getMcpStatus,
  });

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // densité de pagination (Réglages → Général → Rendu de la grille)
  const [pageDensity, setPageDensityState] =
    useState<PageDensity>(getPageDensity);
  // taille des tuiles (réglage visuel)
  const [tileSize, setTileSizeState] = useState<TileSize>(getTileSize);
  // apparence (style, typographie, boutons, arrière-plan) — réactive
  const appearance = useAppearance();
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const [bgBusy, setBgBusy] = useState(false);

  async function pickBackgroundImage(file: File | undefined) {
    if (!file) return;
    setBgBusy(true);
    try {
      const image = await imageFileToDataUrl(file);
      updateAppearance({ bg: { kind: "image", image } satisfies BgState });
      toast.success("Arrière-plan personnalisé appliqué");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBgBusy(false);
    }
  }
  const [checking, setChecking] = useState(false);
  const [deadLinks, setDeadLinks] = useState<DeadLink[] | null>(null);
  const [waybackBusy, setWaybackBusy] = useState<number | null>(null);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // --- Lancement au démarrage ---
  const { data: autostart } = useQuery({
    queryKey: ["autostart"],
    queryFn: getAutostart,
  });
  const [autostartBusy, setAutostartBusy] = useState(false);

  async function toggleAutostart(enabled: boolean) {
    setAutostartBusy(true);
    try {
      await setAutostart(enabled);
      toast.success(
        enabled
          ? "Vaultly démarrera avec Windows"
          : "Lancement au démarrage désactivé",
      );
      void qc.invalidateQueries({ queryKey: ["autostart"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setAutostartBusy(false);
    }
  }

  // --- Corbeille : voir l'onglet dédié « Corbeille » dans le header ---

  const [regenBusy, setRegenBusy] = useState(false);

  // --- Applications d'ouverture (navigateur + notes externes) ---
  const { data: openers } = useQuery({
    queryKey: ["openers"],
    queryFn: detectOpeners,
  });
  const { data: openPrefs } = useQuery({
    queryKey: ["openPrefs"],
    queryFn: getOpenPrefs,
  });
  const [openBusy, setOpenBusy] = useState(false);

  async function applyOpenPrefs(browserPath: string, noteAppPath: string) {
    setOpenBusy(true);
    try {
      await setOpenPrefs(browserPath, noteAppPath);
      toast.success("Préférences d'ouverture enregistrées");
      void qc.invalidateQueries({ queryKey: ["openPrefs"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setOpenBusy(false);
    }
  }

  async function pickCustomOpener(kind: "browser" | "note") {
    try {
      const file = await openFileDialog({
        multiple: false,
        title:
          kind === "browser"
            ? "Choisir le navigateur"
            : "Choisir l'application de notes",
        filters: [{ name: "Exécutable", extensions: ["exe"] }],
      });
      if (typeof file !== "string") return;
      const prefs = openPrefs ?? { browserPath: "", noteAppPath: "" };
      if (kind === "browser") {
        await applyOpenPrefs(file, prefs.noteAppPath);
      } else {
        await applyOpenPrefs(prefs.browserPath, file);
      }
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  // --- Mise à jour (GitHub Releases) ---
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [available, setAvailable] = useState<Update | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    if (section !== "maj" || appVersion !== null) return;
    void currentVersion().then(setAppVersion);
  }, [section, appVersion]);

  async function runUpdateCheck() {
    setUpdateBusy(true);
    setUpdateStatus("Vérification…");
    try {
      const update = await checkForUpdates();
      markUpdateChecked();
      setAvailable(update);
      setUpdateStatus(
        update ? `Version ${update.version} disponible.` : "Tu es à jour 🎉",
      );
    } catch {
      setUpdateStatus(
        "Vérification impossible (hors-ligne, ou signatures pas encore configurées).",
      );
    } finally {
      setUpdateBusy(false);
    }
  }

  function runUpdateInstall() {
    if (!available) return;
    const version = available.version;
    setConfirm({
      title: `Installer la version ${version} ?`,
      message:
        "Le téléchargement vérifié sera installé puis l'app redémarrera.",
      confirmLabel: "Installer",
      action: async () => {
        setUpdateBusy(true);
        try {
          await installUpdate(available);
        } catch (e) {
          toast.error(
            `Installation impossible : ${String(e)} (clé de signature manquante ?)`,
          );
        } finally {
          setUpdateBusy(false);
        }
      },
    });
  }

  async function runRegenerateToken() {
    setConfirm({
      title: "Régénérer le token MCP ?",
      message:
        "Les clients IA déjà configurés devront être mis à jour. Le token de l'extension n'est pas affecté.",
      confirmLabel: "Régénérer",
      action: async () => {
        setRegenBusy(true);
        try {
          await mcpRegenerateToken();
          toast.success("Nouveau token généré — mets à jour tes clients MCP");
          void qc.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(describeError(e));
        } finally {
          setRegenBusy(false);
        }
      },
    });
  }

  async function runRegenerateAddToken() {
    setConfirm({
      title: "Régénérer le token de l'extension ?",
      message:
        "Il faudra recoller le nouveau token dans le popup de l'extension navigateur.",
      confirmLabel: "Régénérer",
      action: async () => {
        setRegenBusy(true);
        try {
          await apiRegenerateToken();
          toast.success("Nouveau token généré — recolle-le dans l'extension");
          void qc.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(describeError(e));
        } finally {
          setRegenBusy(false);
        }
      },
    });
  }

  async function runDeadLinkCheck() {
    setChecking(true);
    setDeadLinks(null);
    try {
      const dead = await checkDeadLinks();
      setDeadLinks(dead);
      // la pastille de l'onglet Réglages suit la vérification manuelle
      localStorage.setItem(
        "vaultly-deadlinks",
        JSON.stringify({ at: Date.now(), count: dead.length }),
      );
      window.dispatchEvent(new CustomEvent("vaultly:deadlinks-changed"));
      toast.success(
        dead.length === 0
          ? "Tous les liens semblent vivants 🎉"
          : `${dead.length} lien(s) ne répondent plus`,
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setChecking(false);
    }
  }

  /** Cherche une capture archive.org du lien mort : trouvée → lien copié ;
   *  absente → ouvre la demande de sauvegarde (web.archive.org/save/…). */
  async function runWayback(d: DeadLink) {
    setWaybackBusy(d.id);
    try {
      const snap = await waybackAvailable(d.url);
      if (snap) {
        await navigator.clipboard.writeText(snap.url).catch(() => {});
        suppressClipboardCapture(snap.url);
        const ts = snap.timestamp;
        const when =
          ts.length >= 8
            ? ` (${ts.slice(6, 8)}/${ts.slice(4, 6)}/${ts.slice(0, 4)})`
            : "";
        toast.success(`Archive trouvée${when} — lien copié`);
      } else {
        toast.info("Aucune archive trouvée — demande de sauvegarde envoyée");
        // web.archive.org/save/<url> accepte l'URL telle quelle (le chemin
        // complet fait partie de l'endpoint — pas d'encodage ici)
        void openUrl(`https://web.archive.org/save/${d.url}`).catch(() => {});
      }
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWaybackBusy(null);
    }
  }

  async function runExport() {
    try {
      const path = await saveFileDialog({
        title: "Exporter la bibliothèque",
        defaultPath: "vaultly-export.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      setExporting(true);
      const n = await exportData(path);
      toast.success(`${n} ressource(s) exportée(s)`);
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setExporting(false);
    }
  }

  async function runImport() {
    try {
      const path = await openFileDialog({
        title: "Importer une sauvegarde",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      setImporting(true);
      const r = await importData(path);
      toast.success(
        `${r.resourcesAdded} ressource(s) ajoutée(s), ${r.duplicates} doublon(s), ${r.foldersAdded} dossier(s)${
          r.invalid > 0
            ? ` · ${r.invalid} entrée(s) invalide(s) ignorée(s)`
            : ""
        }`,
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setImporting(false);
    }
  }

  const url = status?.url ?? "http://127.0.0.1:8765/mcp";
  const token = status?.token ?? "";
  const addToken = status?.addToken ?? "";

  const zcodeSnippet = JSON.stringify(
    {
      mcp: {
        servers: {
          vaultly: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
    },
    null,
    2,
  );

  const claudeSnippet = `claude mcp add --transport http vaultly ${url} \\
  --header "Authorization: Bearer ${token}"`;

  const cursorSnippet = JSON.stringify(
    {
      mcpServers: {
        vaultly: {
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="flex h-full min-h-0">
      {/* sidebar des rubriques */}
      <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-card/40 p-3">
        <h2 className="px-2 pb-2 pt-1 text-sm font-semibold">Réglages</h2>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pickSection(s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              section === s.id
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <s.icon className="size-4 shrink-0" />
            {s.label}
          </button>
        ))}
      </aside>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {section === "apparence" && (
            <>
              {/* style d'ambiance */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Style d'ambiance</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    La palette de couleurs de toute l'interface — appliquée
                    aussitôt, en mode clair comme en mode sombre.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {STYLES.map((s) => {
                    const active = appearance.style === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => updateAppearance({ style: s.id })}
                        aria-pressed={active}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          active
                            ? "border-primary ring-2 ring-primary/30"
                            : "cursor-pointer border-border hover:bg-accent/50",
                        )}
                      >
                        <span
                          className="flex items-center gap-1.5"
                          aria-hidden="true"
                        >
                          <span
                            className="size-4 rounded-full border border-black/10"
                            style={{ background: s.swatch.bg }}
                          />
                          <span
                            className="size-4 rounded-full"
                            style={{ background: s.swatch.primary }}
                          />
                          <span
                            className="size-4 rounded-full"
                            style={{ background: s.swatch.accent }}
                          />
                          {active && (
                            <Check className="ml-auto size-4 text-primary" />
                          )}
                        </span>
                        <span className="mt-2 block text-sm font-medium">
                          {s.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {s.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* typographie */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Typographie</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    La police utilisée partout dans l'interface, titres comme
                    texte.
                  </p>
                </div>
                <Select
                  value={appearance.font}
                  onValueChange={(v) => updateAppearance({ font: v as FontId })}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONTS.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <span style={{ fontFamily: f.stack }}>{f.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p
                  className="text-sm text-muted-foreground"
                  style={{
                    fontFamily: FONTS.find((f) => f.id === appearance.font)
                      ?.stack,
                  }}
                >
                  Aperçu : classez et retrouvez tout ce que vous aimez.
                  1234567890
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-sm text-muted-foreground">
                    Taille :
                  </span>
                  {FONT_SCALES.map((s) => (
                    <Button
                      key={s.id}
                      variant={
                        appearance.fontScale === s.id ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() => updateAppearance({ fontScale: s.id })}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Separator />

              {/* style des boutons */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Style des boutons</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    La forme et l'effet des boutons de toute l'app — l'aperçu
                    ci-dessous suit ton choix en direct.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BUTTON_STYLES.map((b) => {
                    const active = appearance.buttons === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => updateAppearance({ buttons: b.id })}
                        aria-pressed={active}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          active
                            ? "border-primary ring-2 ring-primary/30"
                            : "cursor-pointer border-border hover:bg-accent/50",
                        )}
                      >
                        <span className="flex items-center justify-between text-sm font-medium">
                          {b.label}
                          {active && <Check className="size-4 text-primary" />}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {b.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/40 p-3">
                  <span className="text-xs text-muted-foreground">
                    Aperçu :
                  </span>
                  <Button size="sm">Action</Button>
                  <Button size="sm" variant="secondary">
                    Secondaire
                  </Button>
                  <Button size="sm" variant="outline">
                    Contour
                  </Button>
                </div>
              </div>

              <Separator />

              {/* arrière-plan */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Arrière-plan</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Un fond derrière l'interface : dégradé prêt à l'emploi ou ta
                    propre image.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateAppearance({ bg: { kind: "default" } })
                    }
                    aria-pressed={appearance.bg.kind === "default"}
                    title="Fond uni du style"
                    className={cn(
                      "h-14 w-24 cursor-pointer rounded-xl border bg-muted text-xs font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      appearance.bg.kind === "default" &&
                        "border-primary text-foreground ring-2 ring-primary/30",
                    )}
                  >
                    Défaut
                  </button>
                  {BG_GRADIENTS.map((g) => {
                    const active =
                      appearance.bg.kind === "gradient" &&
                      appearance.bg.id === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          updateAppearance({
                            bg: { kind: "gradient", id: g.id },
                          })
                        }
                        aria-pressed={active}
                        title={g.label}
                        style={{ backgroundImage: g.css }}
                        className={cn(
                          "h-14 w-24 cursor-pointer rounded-xl border border-border bg-background text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          active && "border-primary ring-2 ring-primary/30",
                        )}
                      >
                        <span className="rounded bg-background/70 px-1.5 py-0.5">
                          {g.label}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => bgFileRef.current?.click()}
                    disabled={bgBusy}
                    aria-pressed={appearance.bg.kind === "image"}
                    title="Choisir une image sur ton PC"
                    className={cn(
                      "flex h-14 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-accent/50 disabled:opacity-60",
                      appearance.bg.kind === "image" &&
                        "border-primary text-foreground ring-2 ring-primary/30",
                    )}
                  >
                    {bgBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                    Mon image…
                  </button>
                </div>
                {appearance.bg.kind === "image" && (
                  <div className="flex items-center gap-3">
                    <img
                      src={appearance.bg.image}
                      alt="Arrière-plan personnalisé"
                      className="h-14 w-24 rounded-lg border object-cover"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateAppearance({ bg: { kind: "default" } })
                      }
                    >
                      <Trash2 />
                      Retirer
                    </Button>
                  </div>
                )}
                {appearance.bg.kind !== "default" && (
                  <label className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">Assombrir</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(appearance.bgDim * 100)}
                      onChange={(e) =>
                        updateAppearance({
                          bgDim: Number(e.target.value) / 100,
                        })
                      }
                      className="w-40 accent-primary"
                    />
                    <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                      {Math.round(appearance.bgDim * 100)} %
                    </span>
                  </label>
                )}
                {/* sélecteur de fichier image (dialog natif du WebView) */}
                <input
                  ref={bgFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    void pickBackgroundImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          )}

          {section === "ia" && (
            <>
              {/* statut serveur */}
              <div className="rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <Plug className="size-4 text-muted-foreground" />
                  <span className="font-medium">Serveur MCP intégré</span>
                  {isLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : status?.running ? (
                    <Badge>En ligne · port {status.port}</Badge>
                  ) : (
                    <Badge variant="destructive">Hors ligne</Badge>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Tant que Vaultly est ouvert, toute IA compatible MCP peut
                  rechercher, consulter et enrichir tes ressources via ce
                  serveur local. Les requêtes distantes exigent le token
                  ci-dessous.
                </p>
              </div>

              <Separator />

              {/* snippets */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">Connecter un assistant IA</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ajoute ce serveur à ton client MCP préféré. Le token est
                    propre à cette machine — ne le partage pas.
                  </p>
                </div>

                {/* jamais de snippet avec un « Bearer » vide : tant que le statut
              n'a pas répondu, le copier produirait une config cassée */}
                {!token ? (
                  <p className="text-sm text-muted-foreground">
                    {status
                      ? "Serveur hors ligne — token indisponible."
                      : "Chargement du token…"}
                  </p>
                ) : (
                  <>
                    <CopyBlock
                      label="ZCode — à coller dans ~/.zcode/cli/config.json"
                      code={zcodeSnippet}
                    />

                    <CopyBlock
                      label="Claude Code — commande à exécuter"
                      code={claudeSnippet}
                    />

                    <CopyBlock
                      label="Cursor — à coller dans ~/.cursor/mcp.json"
                      code={cursorSnippet}
                    />
                  </>
                )}
              </div>

              <Separator />

              {/* token MCP brut (clients IA) */}
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">
                  Token MCP (clients IA)
                </span>
                <code className="break-all rounded-lg bg-muted p-2 text-xs">
                  {token || "…"}
                </code>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => {
                      void navigator.clipboard.writeText(token);
                    }}
                  >
                    <Copy />
                    Copier le token
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => void runRegenerateToken()}
                    disabled={regenBusy}
                  >
                    {regenBusy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Régénérer
                  </Button>
                </div>
              </div>
            </>
          )}

          {section === "general" && (
            <>
              {/* raccourci global de la palette */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">
                    Raccourci global de la palette
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Fonctionne partout dans Windows, même Vaultly réduite.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {["ctrl+alt+space", "ctrl+alt+c", "ctrl+shift+p"].map(
                    (sc) => (
                      <Button
                        key={sc}
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setGlobalShortcut(sc)
                            .then(() => toast.success(`Raccourci : ${sc}`))
                            .catch((e) => toast.error(describeError(e)))
                        }
                      >
                        {sc.toUpperCase()}
                      </Button>
                    ),
                  )}
                </div>
              </div>

              <Separator />

              {/* rendu de la grille : rangées par page (pagination) */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Rendu de la grille</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    La bibliothèque est paginée (plus de défilement) : on
                    choisit ici combien de rangées de tuiles tiennent sur une
                    page. Les colonnes s'adaptent automatiquement à la largeur
                    de la fenêtre.
                  </p>
                </div>
                <Select
                  value={pageDensity}
                  onValueChange={(v) => {
                    const next = v as PageDensity;
                    setPageDensityState(next);
                    persistPageDensity(next);
                  }}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_DENSITIES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {
                    PAGE_DENSITIES.find((m) => m.value === pageDensity)
                      ?.description
                  }
                </p>
              </div>

              <Separator />

              {/* taille des tuiles (réglage visuel) */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Taille des tuiles</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Change la densité de la bibliothèque : plus les tuiles sont
                    petites, plus tu en vois à l'écran. La grille reste fluide
                    (les tuiles s'élargissent pour remplir la fenêtre).
                  </p>
                </div>
                <Select
                  value={tileSize}
                  onValueChange={(v) => {
                    const next = v as TileSize;
                    setTileSizeState(next);
                    persistTileSize(next);
                  }}
                >
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TILE_SIZES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label} ({s.minPx} px)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* lancement au démarrage + présence système */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Lancement au démarrage</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Vaultly reste actif dans la barre des tâches : la croix de
                    la fenêtre masque l'app (le raccourci global la fait
                    resurgir), et « Quitter » dans le menu de l'icône sauvegarde
                    puis ferme.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="autostart"
                    checked={autostart ?? false}
                    disabled={autostartBusy || autostart === undefined}
                    onCheckedChange={(v) => void toggleAutostart(v)}
                  />
                  <Label
                    htmlFor="autostart"
                    className="flex items-center gap-2"
                  >
                    <Power className="size-4 text-muted-foreground" />
                    Ouvrir automatiquement à l'ouverture de session Windows
                  </Label>
                </div>
              </div>

              <Separator />

              {/* journal de logs (support) */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Journal d'activité</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    En cas de bug, ouvre le dossier des logs et joins le fichier
                    du jour à ton rapport.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() =>
                    void openLogsFolder().catch((e) =>
                      toast.error(describeError(e)),
                    )
                  }
                >
                  <FileText />
                  Ouvrir le dossier des logs
                </Button>
              </div>
            </>
          )}

          {section === "ouverture" && (
            <>
              {/* navigateur par défaut */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Navigateur d'ouverture</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quel navigateur ouvre tes liens web. « Système » = ton
                    navigateur par défaut Windows.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <OpenerOption
                    active={!openPrefs?.browserPath}
                    onClick={() =>
                      void applyOpenPrefs("", openPrefs?.noteAppPath ?? "")
                    }
                    title="Système (défaut Windows)"
                  />
                  {(openers?.browsers ?? []).map((b) => (
                    <OpenerOption
                      key={b.id}
                      active={openPrefs?.browserPath === b.path}
                      onClick={() =>
                        void applyOpenPrefs(
                          b.path,
                          openPrefs?.noteAppPath ?? "",
                        )
                      }
                      title={b.name}
                      subtitle={b.path}
                    />
                  ))}
                  {openPrefs?.browserPath &&
                    !(openers?.browsers ?? []).some(
                      (b) => b.path === openPrefs.browserPath,
                    ) && (
                      <OpenerOption
                        active
                        onClick={() =>
                          void applyOpenPrefs(
                            openPrefs.browserPath,
                            openPrefs?.noteAppPath ?? "",
                          )
                        }
                        title={exeBase(openPrefs.browserPath)}
                        subtitle={openPrefs.browserPath}
                      />
                    )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={openBusy}
                  onClick={() => void pickCustomOpener("browser")}
                >
                  <FileInput />
                  Choisir un exécutable…
                </Button>
              </div>

              <Separator />

              {/* application de notes externe */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Application de notes</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sans réglage, les notes s'ouvrent dans le lecteur intégré.
                    Avec une application, la note est exportée vers
                    Documents\Vaultly\Notes à chaque ouverture — les
                    modifications externes ne reviennent pas dans Vaultly.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <OpenerOption
                    active={!openPrefs?.noteAppPath}
                    onClick={() =>
                      void applyOpenPrefs(openPrefs?.browserPath ?? "", "")
                    }
                    title="Vaultly (lecteur intégré)"
                  />
                  {(openers?.noteApps ?? []).map((b) => (
                    <OpenerOption
                      key={b.id}
                      active={openPrefs?.noteAppPath === b.path}
                      onClick={() =>
                        void applyOpenPrefs(
                          openPrefs?.browserPath ?? "",
                          b.path,
                        )
                      }
                      title={b.name}
                      subtitle={b.path}
                    />
                  ))}
                  {openPrefs?.noteAppPath &&
                    !(openers?.noteApps ?? []).some(
                      (b) => b.path === openPrefs.noteAppPath,
                    ) && (
                      <OpenerOption
                        active
                        onClick={() =>
                          void applyOpenPrefs(
                            openPrefs?.browserPath ?? "",
                            openPrefs.noteAppPath,
                          )
                        }
                        title={exeBase(openPrefs.noteAppPath)}
                        subtitle={openPrefs.noteAppPath}
                      />
                    )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={openBusy}
                  onClick={() => void pickCustomOpener("note")}
                >
                  <FileInput />
                  Choisir un exécutable…
                </Button>
              </div>
            </>
          )}

          {section === "links" && (
            <>
              {/* liens morts */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Liens morts</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Vérifie que chaque lien web de ta bibliothèque répond encore
                    (404, 5xx, erreur réseau). Ça peut prendre quelques
                    secondes.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void runDeadLinkCheck()}
                  disabled={checking}
                >
                  {checking ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Link2Off />
                  )}
                  Vérifier les liens
                </Button>
                {deadLinks && deadLinks.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-xl border p-2">
                    {deadLinks.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                      >
                        <Link2Off className="size-4 shrink-0 text-destructive" />
                        <button
                          type="button"
                          // ouverture via le plugin opener (comme partout ailleurs),
                          // jamais par un <a href> qui naviguerait dans le WebView
                          onClick={() =>
                            void openUrl(d.url).catch((e) =>
                              toast.error(describeError(e)),
                            )
                          }
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 truncate text-left"
                          title={d.url}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {d.title}
                          </span>
                          <span className="shrink-0 text-xs text-destructive">
                            {d.reason}
                          </span>
                          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                        </button>
                        {/* Wayback : retrouver une capture du lien mort, ou en demander une */}
                        <button
                          type="button"
                          onClick={() => void runWayback(d)}
                          disabled={waybackBusy === d.id}
                          title="Chercher ce lien dans les archives Internet (archive.org)"
                          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          {waybackBusy === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Archive className="size-3.5" />
                          )}
                          Archiver
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {section === "extension" && (
            <>
              {/* extension navigateur */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Extension navigateur</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ajoute la page courante en un clic depuis Brave, Chrome ou
                    Edge.
                  </p>
                </div>
                <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    Ouvre{" "}
                    <code className="rounded bg-muted px-1">
                      brave://extensions
                    </code>{" "}
                    (ou{" "}
                    <code className="rounded bg-muted px-1">
                      chrome://extensions
                    </code>
                    )
                  </li>
                  <li>
                    Active le <b>Mode développeur</b> (coin haut droit)
                  </li>
                  <li>
                    Clique <b>Charger l'extension non empaquetée</b> puis
                    sélectionne le dossier{" "}
                    <code className="rounded bg-muted px-1">extension</code> à
                    la racine du projet Vaultly
                  </li>
                  <li>
                    Clique l'icône Vaultly dans la barre et colle le{" "}
                    <b>token de l'extension</b> (ci-dessous) une seule fois
                  </li>
                </ol>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">
                    Token de l'extension
                  </span>
                  <p className="text-xs text-muted-foreground">
                    N'autorise que l'ajout de ressources (POST /api/add). Lire,
                    modifier, supprimer ou lancer des apps reste réservé au
                    token MCP.
                  </p>
                  <code className="break-all rounded-lg bg-muted p-2 text-xs">
                    {addToken || "…"}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => {
                        void navigator.clipboard.writeText(addToken);
                      }}
                    >
                      <Copy />
                      Copier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => void runRegenerateAddToken()}
                      disabled={regenBusy}
                    >
                      {regenBusy ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                      Régénérer
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Vaultly doit être ouvert pour recevoir les ajouts — et copier
                  une URL suffit : l'app propose automatiquement de l'ajouter
                  (Ctrl+N pour ouvrir le formulaire à la main).
                </p>
              </div>
            </>
          )}

          {section === "backup" && (
            <>
              {/* sauvegarde locale JSON */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Sauvegarde</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Exporte toute ta bibliothèque (ressources + dossiers) en
                    JSON, ou restaure depuis une sauvegarde — les doublons d'URL
                    sont ignorés. Une sauvegarde JSON est aussi créée
                    automatiquement à chaque fermeture de l'app, dans
                    Documents\Vaultly\Sauvegardes (les 10 dernières sont
                    conservées).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void runExport()}
                    disabled={exporting}
                  >
                    {exporting ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    Exporter tout
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runImport()}
                    disabled={importing}
                  >
                    {importing ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Upload />
                    )}
                    Importer une sauvegarde
                  </Button>
                </div>
              </div>

              <Separator />

              <WebDavBackupSection />
            </>
          )}

          {section === "maj" && (
            <>
              {/* mise à jour depuis GitHub Releases */}
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Mise à jour</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Vaultly se met à jour depuis GitHub Releases. Version
                    installée : {appVersion ?? "…"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void runUpdateCheck()}
                    disabled={updateBusy}
                  >
                    {updateBusy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Vérifier
                  </Button>
                  {available && (
                    <Button
                      onClick={() => runUpdateInstall()}
                      disabled={updateBusy}
                    >
                      <Download />
                      Installer la {available.version}
                    </Button>
                  )}
                </div>
                {updateStatus && (
                  <p className="text-sm text-muted-foreground">
                    {updateStatus}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Tant que la clé de signature n'est pas configurée
                  (tauri.conf.json › plugins › updater › pubkey), la
                  vérification répond mais l'installation est refusée — voir
                  .github/workflows/release.yml pour la marche à suivre.
                </p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
