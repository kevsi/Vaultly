import {
  Archive,
  Check,
  Clock,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderPlus,
  History,
  Link2Off,
  Loader2,
  Plug,
  Power,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { save as saveFileDialog, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apiRegenerateToken,
  checkDeadLinks,
  exportData,
  getAutostart,
  importData,
  getMcpStatus,
  mcpRegenerateToken,
  setAutostart,
  waybackAvailable,
  gdriveBackup,
  gdriveConnect,
  gdriveCreateFolder,
  gdriveDeleteFile,
  gdriveDisconnect,
  gdriveDownload,
  gdriveGetSettings,
  gdriveListFiles,
  gdriveRestore,
  gdriveSearchFiles,
  gdriveSetAutobackup,
  gdriveSetBackupFolder,
  gdriveShareFile,
  gdriveStatus as gdriveStatusApi,
  gdriveUpload,
  setGlobalShortcut,
  type DeadLink,
  type DriveFile,
} from "@/lib/api";
import { suppressClipboardCapture } from "@/lib/useClipboardCapture";
import { cn } from "@/lib/utils";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { PromptDialog } from "@/components/PromptDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  setVirtualMode as persistVirtualMode,
  getVirtualMode,
  VIRTUAL_MODES,
  type VirtualMode,
} from "@/lib/gridVirtualization";
import {
  setTileSize as persistTileSize,
  getTileSize,
  TILE_SIZES,
  type TileSize,
} from "@/lib/tileSize";

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
        <label className="text-sm font-medium">{label}</label>
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

// Rubriques de la page Réglages : la sidebar remplace le long scroll unique.
const SECTIONS = [
  { id: "ia", label: "Assistants IA", icon: Plug },
  { id: "extension", label: "Extension", icon: Puzzle },
  { id: "drive", label: "Google Drive", icon: Cloud },
  { id: "links", label: "Liens morts", icon: Link2Off },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "backup", label: "Sauvegarde", icon: Save },
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

  const { data: status, isLoading } = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: getMcpStatus,
  });

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // virtualisation de la grille (Réglages → Général → Rendu de la grille)
  const [virtualMode, setVirtualModeState] = useState<VirtualMode>(getVirtualMode);
  // taille des tuiles (réglage visuel)
  const [tileSize, setTileSizeState] = useState<TileSize>(getTileSize);
  const [checking, setChecking] = useState(false);
  const [deadLinks, setDeadLinks] = useState<DeadLink[] | null>(null);
  const [waybackBusy, setWaybackBusy] = useState<number | null>(null);
  const [gdriveBusy, setGdriveBusy] = useState(false);
  const qcGdrive = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string;
    description?: string;
    placeholder?: string;
    confirmLabel?: string;
    onDone: (v: string | null) => void;
  } | null>(null);

  const { data: gdriveStatus } = useQuery({
    queryKey: ["gdriveStatus"],
    queryFn: gdriveStatusApi,
  });

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
      void qcGdrive.invalidateQueries({ queryKey: ["autostart"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAutostartBusy(false);
    }
  }

  // --- Corbeille : voir l'onglet dédié « Corbeille » dans le header ---

  async function connectGdrive() {
    setGdriveBusy(true);
    try {
      await gdriveConnect();
      toast.success("Google Drive connecté ✓");
      void qcGdrive.invalidateQueries({ queryKey: ["gdriveStatus"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGdriveBusy(false);
    }
  }

  async function disconnectGdrive() {
    try {
      await gdriveDisconnect();
      toast.success("Google Drive déconnecté");
    } catch (e) {
      toast.error(String(e));
    }
    void qcGdrive.invalidateQueries({ queryKey: ["gdriveStatus"] });
  }

  async function tryUpload() {
    setGdriveBusy(true);
    try {
      const link = await gdriveUpload();
      await navigator.clipboard.writeText(link).catch(() => {});
      suppressClipboardCapture(link);
      toast.success(`Fichier envoyé — lien copié : ${link}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGdriveBusy(false);
    }
  }

  // --- Sauvegarde / restauration / explorateur Drive ---
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveActionId, setDriveActionId] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoInterval, setAutoInterval] = useState("24");
  const [autoSaving, setAutoSaving] = useState(false);

  const { data: driveSettings } = useQuery({
    queryKey: ["gdriveSettings"],
    queryFn: gdriveGetSettings,
    enabled: gdriveStatus?.connected === true,
  });

  useEffect(() => {
    if (driveSettings) {
      setAutoEnabled(driveSettings.autobackupEnabled);
      setAutoInterval(String(driveSettings.autobackupIntervalHours));
    }
  }, [driveSettings]);

  function formatBackupDate(ts: number | null | undefined): string {
    if (ts == null) return "Jamais";
    const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
    return new Date(ms).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDriveSize(size: string | null | undefined): string {
    if (size == null || size === "") return "";
    const n = Number(size);
    if (!Number.isFinite(n)) return "";
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
  }

  function formatDriveDate(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function isDriveFolder(f: DriveFile): boolean {
    return f.mimeType === "application/vnd.google-apps.folder";
  }

  async function runBackup() {
    setBackupBusy(true);
    try {
      const r = await gdriveBackup();
      await navigator.clipboard.writeText(r.link).catch(() => {});
      suppressClipboardCapture(r.link);
      toast.success(
        `${r.count} ressource(s) sauvegardée(s) — lien copié : ${r.link}`,
      );
      void qcGdrive.invalidateQueries({ queryKey: ["gdriveSettings"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function runRestore() {
    setConfirm({
      title: "Restaurer le dernier backup Drive ?",
      message: "Les doublons d'URL seront ignorés.",
      confirmLabel: "Restaurer",
      action: async () => {
        setRestoreBusy(true);
        try {
          const r = await gdriveRestore(null);
          toast.success(
            `${r.resourcesAdded} ressource(s) ajoutée(s), ${r.duplicates} doublon(s), ${r.foldersAdded} dossier(s)${
              r.invalid > 0 ? ` · ${r.invalid} entrée(s) invalide(s) ignorée(s)` : ""
            }`,
          );
          void qcGdrive.invalidateQueries({ queryKey: ["resources"] });
          void qcGdrive.invalidateQueries({ queryKey: ["folders"] });
        } catch (e) {
          toast.error(String(e));
        } finally {
          setRestoreBusy(false);
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
          void qcGdrive.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(String(e));
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
          void qcGdrive.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(String(e));
        } finally {
          setRegenBusy(false);
        }
      },
    });
  }

  async function saveAutobackup(enabled: boolean, hoursRaw: string) {
    const hours = Math.max(1, Math.floor(Number(hoursRaw) || 24));
    setAutoInterval(String(hours));
    setAutoSaving(true);
    try {
      await gdriveSetAutobackup(enabled, hours);
      toast.success(
        enabled
          ? `Sauvegarde auto activée (toutes les ${hours} h)`
          : "Sauvegarde auto désactivée",
      );
      void qcGdrive.invalidateQueries({ queryKey: ["gdriveSettings"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAutoSaving(false);
    }
  }

  async function loadDriveFiles() {
    setDriveLoading(true);
    try {
      const q = driveSearch.trim();
      const files = q
        ? await gdriveSearchFiles(q)
        : await gdriveListFiles(null, null);
      setDriveFiles(files);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDriveLoading(false);
    }
  }

  async function runDriveDownload(f: DriveFile) {
    setDriveActionId(f.id);
    try {
      const path = await gdriveDownload(f.id);
      toast.success(`Téléchargé : ${path}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDriveActionId(null);
    }
  }

  async function runDriveShare(f: DriveFile) {
    setDriveActionId(f.id);
    try {
      const link = await gdriveShareFile(f.id);
      await navigator.clipboard.writeText(link).catch(() => {});
      suppressClipboardCapture(link);
      toast.success("Lien de partage copié dans le presse-papiers");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDriveActionId(null);
    }
  }

  async function runDriveDelete(f: DriveFile) {
    setConfirm({
      title: `Supprimer « ${f.name} » de Google Drive ?`,
      message: "Le fichier sera déplacé vers la corbeille de ton Drive.",
      confirmLabel: "Supprimer",
      destructive: true,
      action: async () => {
        setDriveActionId(f.id);
        try {
          await gdriveDeleteFile(f.id);
          setDriveFiles((prev) => prev?.filter((x) => x.id !== f.id) ?? prev);
          toast.success("Fichier supprimé du Drive");
        } catch (e) {
          toast.error(String(e));
        } finally {
          setDriveActionId(null);
        }
      },
    });
  }

  async function runCreateDriveFolder() {
    setPrompt({
      title: "Nouveau dossier Drive",
      placeholder: "Nom du dossier",
      confirmLabel: "Créer",
      onDone: async (name) => {
        setPrompt(null);
        if (!name?.trim()) return;
        try {
          await gdriveCreateFolder(name.trim());
          toast.success(`Dossier « ${name.trim()} » créé`);
          void loadDriveFiles();
        } catch (e) {
          toast.error(String(e));
        }
      },
    });
  }

  async function runSetBackupFolder(f: DriveFile) {
    try {
      await gdriveSetBackupFolder(f.id);
      toast.success(`« ${f.name} » défini comme dossier de backup`);
      void qcGdrive.invalidateQueries({ queryKey: ["gdriveSettings"] });
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function runDeadLinkCheck() {
    setChecking(true);
    setDeadLinks(null);
    try {
      const dead = await checkDeadLinks();
      setDeadLinks(dead);
      toast.success(
        dead.length === 0
          ? "Tous les liens semblent vivants 🎉"
          : `${dead.length} lien(s) ne répondent plus`,
      );
    } catch (e) {
      toast.error(String(e));
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
      toast.error(String(e));
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
      toast.error(String(e));
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
          r.invalid > 0 ? ` · ${r.invalid} entrée(s) invalide(s) ignorée(s)` : ""
        }`,
      );
    } catch (e) {
      toast.error(String(e));
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
            rechercher, consulter et enrichir tes ressources via ce serveur
            local. Les requêtes distantes exigent le token ci-dessous.
          </p>
        </div>

        <Separator />

        {/* snippets */}
        <div className="space-y-4">
          <div>
            <h3 className="font-medium">Connecter un assistant IA</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajoute ce serveur à ton client MCP préféré. Le token est propre à
              cette machine — ne le partage pas.
            </p>
          </div>

          {/* jamais de snippet avec un « Bearer » vide : tant que le statut
              n'a pas répondu, le copier produirait une config cassée */}
          {!token ? (
            <p className="text-sm text-muted-foreground">
              {status ? "Serveur hors ligne — token indisponible." : "Chargement du token…"}
            </p>
          ) : (
            <>
              <CopyBlock label="ZCode — à coller dans ~/.zcode/cli/config.json" code={zcodeSnippet} />

              <CopyBlock label="Claude Code — commande à exécuter" code={claudeSnippet} />

              <CopyBlock label="Cursor — à coller dans ~/.cursor/mcp.json" code={cursorSnippet} />
            </>
          )}
        </div>

        <Separator />

        {/* token MCP brut (clients IA) */}
        <div className="grid gap-1.5">
          <label className="text-sm font-medium">Token MCP (clients IA)</label>
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
            <h3 className="font-medium">Raccourci global de la palette</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fonctionne partout dans Windows, même Vaultly réduite.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {["ctrl+alt+space", "ctrl+alt+c", "ctrl+shift+p"].map((sc) => (
              <Button
                key={sc}
                variant="outline"
                size="sm"
                onClick={() =>
                  setGlobalShortcut(sc)
                    .then(() => toast.success(`Raccourci : ${sc}`))
                    .catch((e) => toast.error(String(e)))
                }
              >
                {sc.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        {/* rendu de la grille : seuil de virtualisation */}
        <div className="space-y-3">
          <div>
            <h3 className="font-medium">Rendu de la grille</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Au-delà du seuil choisi, les lignes de la bibliothèque sont
              virtualisées (seules les lignes visibles existent à l'écran) :
              la grille reste fluide quelle que soit la taille de ta
              bibliothèque. En dessous, rendu natif — plus « vivant » pour
              le glisser-déposer sur de petites collections.
            </p>
          </div>
          <Select
            value={virtualMode}
            onValueChange={(v) => {
              const next = v as VirtualMode;
              setVirtualModeState(next);
              persistVirtualMode(next);
            }}
          >
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIRTUAL_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {VIRTUAL_MODES.find((m) => m.value === virtualMode)?.description}
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
              Vaultly reste actif dans la barre des tâches : la croix de la
              fenêtre masque l'app (le raccourci global la fait resurgir), et
              « Quitter » dans le menu de l'icône sauvegarde puis ferme.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="autostart"
              checked={autostart ?? false}
              disabled={autostartBusy || autostart === undefined}
              onCheckedChange={(v) => void toggleAutostart(v)}
            />
            <Label htmlFor="autostart" className="flex items-center gap-2">
              <Power className="size-4 text-muted-foreground" />
              Ouvrir automatiquement à l'ouverture de session Windows
            </Label>
          </div>
        </div>
            </>
          )}

          {section === "drive" && (
            <>
        {/* Google Drive */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">Google Drive</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Envoie des fichiers vers ton Drive. Un simple écran Google te
                demandera d'autoriser Vaultly — rien d'autre à configurer.
              </p>
            </div>
            {gdriveStatus?.connected ? (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Connecté
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                Non connecté
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void connectGdrive()} disabled={gdriveBusy}>
              {gdriveBusy ? <Loader2 className="animate-spin" /> : <Plug />}
              {gdriveStatus?.connected ? "Reconnecter" : "Connecter mon compte"}
            </Button>
            {gdriveStatus?.connected && (
              <>
                <Button variant="outline" onClick={() => void tryUpload()} disabled={gdriveBusy}>
                  <Upload />
                  Envoyer un fichier…
                </Button>
                <Button variant="ghost" onClick={() => void disconnectGdrive()}>
                  Déconnecter
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Le serveur de callback utilise le port local 8790. Le lien de
            partage du fichier envoyé est copié dans le presse-papiers.
          </p>

          {gdriveStatus?.connected && (
            <>
              <Separator />

              {/* sauvegarde / restauration */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">
                    Sauvegarde de la bibliothèque
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Envoie une sauvegarde JSON sur ton Drive, ou restaure la
                    dernière — les doublons d'URL sont ignorés.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void runBackup()}
                    disabled={backupBusy || restoreBusy}
                  >
                    {backupBusy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Save />
                    )}
                    Sauvegarder maintenant
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runRestore()}
                    disabled={restoreBusy || backupBusy}
                  >
                    {restoreBusy ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <History />
                    )}
                    Restaurer le dernier backup
                  </Button>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Dernier backup : {formatBackupDate(driveSettings?.lastBackupAt)}
                </p>

                {/* sauvegarde automatique */}
                <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={autoEnabled}
                      disabled={autoSaving}
                      onCheckedChange={(v) => {
                        setAutoEnabled(v);
                        void saveAutobackup(v, autoInterval);
                      }}
                    />
                    <Label>Sauvegarde automatique</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="autobackup-interval" className="text-xs text-muted-foreground">
                      Toutes les
                    </Label>
                    <Input
                      id="autobackup-interval"
                      type="number"
                      min={1}
                      className="w-20"
                      value={autoInterval}
                      disabled={autoSaving}
                      onChange={(e) => setAutoInterval(e.target.value)}
                      onBlur={() => {
                        if (autoEnabled) void saveAutobackup(true, autoInterval);
                      }}
                    />
                    <span className="text-xs text-muted-foreground">heure(s)</span>
                  </div>
                  {autoSaving && <Loader2 className="size-4 animate-spin" />}
                </div>
              </div>

              <Separator />

              {/* mini explorateur Drive */}
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Explorateur Drive</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Recherche tes fichiers, télécharge-les, partage-les ou
                    choisis le dossier de backup.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 grow">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Rechercher dans le Drive…"
                      className="pl-8"
                      value={driveSearch}
                      onChange={(e) => setDriveSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void loadDriveFiles();
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDriveFiles()}
                    disabled={driveLoading}
                  >
                    {driveLoading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Search />
                    )}
                    {driveSearch.trim() ? "Rechercher" : "Lister mes fichiers"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runCreateDriveFolder()}
                  >
                    <FolderPlus />
                    Nouveau dossier
                  </Button>
                </div>

                {driveLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Chargement des fichiers…
                  </div>
                ) : driveFiles !== null && driveFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun fichier trouvé.
                  </p>
                ) : (
                  driveFiles !== null && (
                    <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border p-2">
                      {driveFiles.map((f) => {
                        const busy = driveActionId === f.id;
                        const folder = isDriveFolder(f);
                        const isBackupFolder =
                          driveSettings?.backupFolderId === f.id;
                        return (
                          <div
                            key={f.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                          >
                            {folder ? (
                              <Folder className="size-4 shrink-0 text-amber-500" />
                            ) : (
                              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">
                                  {f.name}
                                </span>
                                {isBackupFolder && (
                                  <Badge variant="outline">backup</Badge>
                                )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {[
                                  formatDriveDate(f.modifiedTime),
                                  formatDriveSize(f.size),
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </div>
                            {folder && !isBackupFolder && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Définir comme dossier de backup"
                                onClick={() => void runSetBackupFolder(f)}
                              >
                                <Save />
                                <span className="hidden xl:inline">Backup ici</span>
                              </Button>
                            )}
                            {!folder && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Télécharger"
                                disabled={busy}
                                onClick={() => void runDriveDownload(f)}
                              >
                                {busy ? (
                                  <Loader2 className="animate-spin" />
                                ) : (
                                  <Download />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Partager (copie le lien)"
                              disabled={busy}
                              onClick={() => void runDriveShare(f)}
                            >
                              {busy ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Share2 />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Supprimer"
                              disabled={busy}
                              onClick={() => void runDriveDelete(f)}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </>
          )}
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
              (404, 5xx, erreur réseau). Ça peut prendre quelques secondes.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void runDeadLinkCheck()}
            disabled={checking}
          >
            {checking ? <Loader2 className="animate-spin" /> : <Link2Off />}
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
                      void openUrl(d.url).catch((e) => toast.error(String(e)))
                    }
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 truncate text-left"
                    title={d.url}
                  >
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
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
              Ajoute la page courante en un clic depuis Brave, Chrome ou Edge.
            </p>
          </div>
          <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
            <li>
              Ouvre <code className="rounded bg-muted px-1">brave://extensions</code>{" "}
              (ou <code className="rounded bg-muted px-1">chrome://extensions</code>)
            </li>
            <li>
              Active le <b>Mode développeur</b> (coin haut droit)
            </li>
            <li>
              Clique <b>Charger l'extension non empaquetée</b> puis sélectionne
              le dossier{" "}
              <code className="rounded bg-muted px-1">extension</code> à la
              racine du projet Vaultly
            </li>
            <li>
              Clique l'icône Vaultly dans la barre et colle le{" "}
              <b>token de l'extension</b> (ci-dessous) une seule fois
            </li>
          </ol>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">Token de l'extension</label>
            <p className="text-xs text-muted-foreground">
              N'autorise que l'ajout de ressources (POST /api/add). Lire,
              modifier, supprimer ou lancer des apps reste réservé au token MCP.
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
            Vaultly doit être ouvert pour recevoir les ajouts — et copier une
            URL suffit : l'app propose automatiquement de l'ajouter (Ctrl+N pour
            ouvrir le formulaire à la main).
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
              Exporte toute ta bibliothèque (ressources + dossiers) en JSON,
              ou restaure depuis une sauvegarde — les doublons d'URL sont ignorés.
              Une sauvegarde JSON est aussi créée automatiquement à chaque
              fermeture de l'app, dans Documents\Vaultly\Sauvegardes
              (les 10 dernières sont conservées).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void runExport()} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              Exporter tout
            </Button>
            <Button variant="outline" onClick={() => void runImport()} disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              Importer une sauvegarde
            </Button>
          </div>
        </div>
            </>
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <PromptDialog
        open={prompt !== null}
        title={prompt?.title ?? ""}
        description={prompt?.description}
        placeholder={prompt?.placeholder}
        confirmLabel={prompt?.confirmLabel}
        onDone={(v) => void prompt?.onDone(v)}
      />
    </div>
  );
}
