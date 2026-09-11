import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  Check,
  FileUp,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { detectBrowserProfiles, importBookmarks } from "@/lib/api";
import { parseCsv, parseNetscapeHtml } from "@/lib/fileImport";
import { useI18n } from "@/lib/i18n";
import type {
  BrowserProfile,
  ImportedBookmark,
  ImportReport,
} from "@/lib/types";
import { describeError } from "@/lib/utils";

const BROWSER_LABELS: Record<string, string> = {
  brave: "Brave",
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  file: "Fichier",
};

export function ImportView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [tags, setTags] = useState("import");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  // import depuis un fichier : favoris lus en mémoire, fusionnés aux
  // profils navigateurs (même sélection, même bouton d'import)
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBookmarks, setFileBookmarks] = useState<ImportedBookmark[] | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileKindRef = useRef<"html" | "csv">("html");

  const {
    data: profiles,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["browserProfiles"],
    queryFn: detectBrowserProfiles,
  });

  // clé stable = l'URL du favori (pas sa position) : après « Redétecter »,
  // un réordonnancement ne décale plus les coches
  function keyOf(p: BrowserProfile, b: { url: string; folder?: string }) {
    // le dossier fait partie de la clé : un export Netscape contient
    // fréquemment la même URL dans deux dossiers — sans lui, deux lignes
    // portent la même clé React et leurs coches se suivent mutuellement
    return `${p.browser}:${p.name}:${b.folder ?? ""}:${b.url}`;
  }

  /** Pseudo-profil du fichier : mêmes sélection et import que les
   *  navigateurs, sans toucher au backend. */
  const fileProfile: BrowserProfile | null =
    fileBookmarks && fileBookmarks.length > 0 && fileName
      ? {
          browser: "file",
          name: fileName,
          count: fileBookmarks.length,
          bookmarks: fileBookmarks,
        }
      : null;
  const allProfiles = [
    ...(fileProfile ? [fileProfile] : []),
    ...(profiles ?? []),
  ];

  function openFilePicker(kind: "html" | "csv") {
    fileKindRef.current = kind;
    if (fileInputRef.current) {
      fileInputRef.current.accept =
        kind === "html" ? ".html,.htm" : ".csv,.txt";
      fileInputRef.current.click();
    }
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("Fichier trop lourd (10 Mo maximum)"));
      return;
    }
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase();
      const bookmarks =
        fileKindRef.current === "html" || ext === "html" || ext === "htm"
          ? parseNetscapeHtml(text)
          : parseCsv(text);
      setFileName(file.name);
      setFileBookmarks(bookmarks);
      setReport(null);
      toast.success(
        t("{count} favori(s) lu(s) depuis {file}", {
          count: bookmarks.length,
          file: file.name,
        }),
      );
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  function clearFile() {
    setFileName(null);
    setFileBookmarks(null);
  }

  function isAllSelected(p: BrowserProfile) {
    return p.bookmarks.every((b) => selection[keyOf(p, b)] !== false);
  }

  function toggleAll(p: BrowserProfile) {
    const all = isAllSelected(p);
    setSelection((s) => {
      const next = { ...s };
      p.bookmarks.forEach((b) => {
        next[keyOf(p, b)] = !all;
      });
      return next;
    });
  }

  async function runImport() {
    const bookmarks = allProfiles.flatMap((p) =>
      p.bookmarks.filter((b) => selection[keyOf(p, b)] !== false),
    );
    if (bookmarks.length === 0) {
      toast.error(t("Aucun favori sélectionné"));
      return;
    }
    setImporting(true);
    try {
      const r = await importBookmarks(
        bookmarks,
        "",
        tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      );
      setReport(r);
      toast.success(t("{count} favori(s) importé(s)", { count: r.added }));
      void qc.invalidateQueries({ queryKey: ["resources"] });
      void qc.invalidateQueries({ queryKey: ["allTags"] });
      void qc.invalidateQueries({ queryKey: ["folders"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {t("Importer des favoris")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Détecte les favoris de tes navigateurs, ou importe un fichier. Les doublons d'URL sont ignorés automatiquement.",
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading || isRefetching}
          >
            {isRefetching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {t("Redétecter")}
          </Button>
        </div>
        {/* import depuis un fichier : HTML Netscape ou CSV */}
        <div className="space-y-2 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openFilePicker("html")}
              title={t("Export « favoris HTML » de n'importe quel navigateur")}
            >
              <FileUp />
              {t("Fichier HTML…")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openFilePicker("csv")}
              title={t(
                "Export CSV type Pocket ou Raindrop (colonnes url, titre…)",
              )}
            >
              <FileUp />
              {t("Fichier CSV…")}
            </Button>
            {fileProfile && (
              <>
                <Badge variant="secondary">
                  {t("{name} · {count} favori(s)", {
                    name: fileProfile.name,
                    count: fileProfile.count,
                  })}
                </Badge>
                <Button variant="ghost" size="sm" onClick={clearFile}>
                  <X />
                  {t("Retirer")}
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "HTML Netscape (« Exporter les favoris ») ou CSV Pocket/Raindrop : les favoris lus s'ajoutent ci-dessous, à cocher comme les autres.",
            )}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              void onFileChosen(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            {t("Détection des navigateurs…")}
          </div>
        ) : isError && allProfiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-destructive/40 bg-destructive/5 p-8 text-center text-sm text-muted-foreground">
            {t(
              "Détection impossible — redémarre Vaultly si le problème persiste.",
            )}
          </div>
        ) : allProfiles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t(
              "Aucun favori détecté dans Brave, Chrome, Edge ou Firefox. Assure-toi que le navigateur est installé et contient des favoris — ou importe un fichier HTML/CSV ci-dessus.",
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {allProfiles.map((p) => (
              <section
                key={`${p.browser}:${p.name}`}
                className="overflow-hidden rounded-xl border"
              >
                {/* en-tête du profil */}
                <header className="flex items-center gap-2.5 bg-muted/40 px-4 py-3">
                  <BookmarkPlus className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">
                    {t(BROWSER_LABELS[p.browser] ?? p.browser)}
                  </span>
                  <Badge variant="secondary">{p.name}</Badge>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {t("{count} favori(s)", { count: p.count })}
                  </span>
                  <span className="grow" />
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => toggleAll(p)}
                  >
                    {isAllSelected(p) ? t("Tout décocher") : t("Tout cocher")}
                  </Button>
                </header>
                <Separator />
                {/* liste des favoris */}
                <div className="max-h-80 overflow-y-auto p-2">
                  <div className="grid gap-0.5 sm:grid-cols-2">
                    {p.bookmarks.map((b) => {
                      const k = keyOf(p, b);
                      const checked = selection[k] !== false;
                      return (
                        // biome-ignore lint/a11y/noLabelWithoutControl: association implicite valide (case enveloppee)
                        <label
                          key={k}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setSelection((s) => ({ ...s, [k]: v === true }))
                            }
                          />
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={`${b.title}\n${b.url}`}
                          >
                            {b.title}
                          </span>
                          {b.folder && (
                            <span
                              className="max-w-28 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                              title={b.folder}
                            >
                              {b.folder.split("/").pop()}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}

            {/* réglages d'import */}
            <div className="space-y-4 rounded-xl border p-4">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium" htmlFor="import-tags">
                  {t("Tags par défaut")}
                </label>
                <Input
                  id="import-tags"
                  placeholder={t("ex : import, a-trier")}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Le dossier d'origine de chaque favori (ex : « Développement/React ») est aussi ajouté comme tag pour rester cherchable.",
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void runImport()} disabled={importing}>
                  {importing ? <Loader2 className="animate-spin" /> : <Check />}
                  {t("Importer la sélection")}
                </Button>
                {report && (
                  <span className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {report.added}
                    </span>{" "}
                    {t("ajouté(s) ·")}{" "}
                    <span className="font-medium text-foreground">
                      {report.duplicates}
                    </span>{" "}
                    {t("doublon(s) ignoré(s)")}
                    {report.errors.length > 0 &&
                      t(" · {count} erreur(s)", {
                        count: report.errors.length,
                      })}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
