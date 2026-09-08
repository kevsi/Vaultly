import { BookmarkPlus, Check, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { detectBrowserProfiles, importBookmarks } from "@/lib/api";
import type { BrowserProfile, ImportReport } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const BROWSER_LABELS: Record<string, string> = {
  brave: "Brave",
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
};

export function ImportView() {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("import");
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const { data: profiles, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["browserProfiles"],
    queryFn: detectBrowserProfiles,
  });

  // clé stable = l'URL du favori (pas sa position) : après « Redétecter »,
  // un réordonnancement ne décale plus les coches
  function keyOf(p: BrowserProfile, b: { url: string }) {
    return `${p.browser}:${p.name}:${b.url}`;
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
    if (!profiles) return;
    const bookmarks = profiles.flatMap((p) =>
      p.bookmarks.filter((b) => selection[keyOf(p, b)] !== false),
    );
    if (bookmarks.length === 0) {
      toast.error("Aucun favori sélectionné");
      return;
    }
    setImporting(true);
    try {
      const r = await importBookmarks(
        bookmarks,
        category.trim(),
        tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      );
      setReport(r);
      toast.success(`${r.added} favori(s) importé(s)`);
      void qc.invalidateQueries({ queryKey: ["resources"] });
      void qc.invalidateQueries({ queryKey: ["allTags"] });
      void qc.invalidateQueries({ queryKey: ["folders"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Importer des favoris</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Détecte les favoris de tes navigateurs. Les doublons d'URL sont
              ignorés automatiquement.
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
            Redétecter
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            Détection des navigateurs…
          </div>
        ) : (profiles ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Aucun favori détecté dans Brave, Chrome, Edge ou Firefox.
            Assure-toi que le navigateur est installé et contient des favoris.
          </div>
        ) : (
          <div className="space-y-4">
            {(profiles ?? []).map((p) => (
              <section
                key={`${p.browser}:${p.name}`}
                className="overflow-hidden rounded-xl border"
              >
                {/* en-tête du profil */}
                <header className="flex items-center gap-2.5 bg-muted/40 px-4 py-3">
                  <BookmarkPlus className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">
                    {BROWSER_LABELS[p.browser] ?? p.browser}
                  </span>
                  <Badge variant="secondary">{p.name}</Badge>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {p.count} favori{p.count > 1 ? "s" : ""}
                  </span>
                  <span className="grow" />
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => toggleAll(p)}
                  >
                    {isAllSelected(p) ? "Tout décocher" : "Tout cocher"}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="import-cat">
                    Catégorie par défaut
                  </label>
                  <Input
                    id="import-cat"
                    placeholder="ex : Import navigateur"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="import-tags">
                    Tags par défaut
                  </label>
                  <Input
                    id="import-tags"
                    placeholder="ex : import, a-trier"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Le dossier d'origine de chaque favori (ex : «
                Développement/React ») est aussi ajouté comme tag pour rester
                cherchable.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void runImport()} disabled={importing}>
                  {importing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Importer la sélection
                </Button>
                {report && (
                  <span className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {report.added}
                    </span>{" "}
                    ajouté(s) ·{" "}
                    <span className="font-medium text-foreground">
                      {report.duplicates}
                    </span>{" "}
                    doublon(s) ignoré(s)
                    {report.errors.length > 0 &&
                      ` · ${report.errors.length} erreur(s)`}
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
