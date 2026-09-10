import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { addResource, fetchMetadata, listResources } from "@/lib/api";
import { fuzzyMatch } from "@/lib/fuzzy";
import { useI18n } from "@/lib/i18n";
import { openResource } from "@/lib/openResource";
import { hostOf, typeLabel } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

/** Ligne de la palette : un résultat, ou l'action « ajouter cette URL ». */
type PaletteItem =
  | { kind: "add"; url: string }
  | { kind: "res"; resource: Resource };

/**
 * Palette de commandes (Ctrl+K dans l'app, Ctrl+Alt+Espace système) :
 * recherche instantanée dans toutes les ressources, Entrée pour ouvrir.
 * Saisir une URL complète propose « Ajouter … » en tête de liste : la
 * palette sert aussi de barre de capture globale.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: all } = useQuery({
    queryKey: ["resources", "palette"],
    // le backend plafonne à 500 : la palette voit tout ce qui est visible
    queryFn: () => listResources({ sortBy: "mostUsed", limit: 500 }),
    enabled: open,
  });

  const results = useMemo(() => {
    const list = all ?? [];
    const q = query.trim();
    if (!q) return list.slice(0, 8);
    // fuzzy : sous-séquence tolérante (fautes d'ordre, initiales), sur le
    // titre (pondéré fort), l'URL, les tags, puis description/notes.
    // Le match direct substring reste le meilleur score.
    const scored: { r: Resource; score: number }[] = [];
    const ql = q.toLowerCase();
    for (const r of list) {
      let best = -Infinity;
      const title = fuzzyMatch(q, r.title);
      if (title) best = title.score * 3;
      const url = fuzzyMatch(q, r.url);
      if (url && url.score * 1.5 > best) best = url.score * 1.5;
      for (const t of r.tags) {
        const s = fuzzyMatch(q, t);
        if (s && s.score * 2 > best) best = s.score * 2;
      }
      // description/notes : substring direct seulement (pas de fuzzy sur
      // des paragraphes — trop de faux positifs)
      const desc = `${r.description ?? ""}\n${r.notes ?? ""}`.toLowerCase();
      if (desc.includes(ql) && best < 4) best = 4;
      if (best > -Infinity) scored.push({ r, score: best });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map((s) => s.r);
  }, [all, query]);

  // une saisie qui est une URL → première ligne = proposition d'ajout
  const urlLike = /^https?:\/\/\S+$/i.test(query.trim()) ? query.trim() : null;
  const items = useMemo<PaletteItem[]>(() => {
    const res: PaletteItem[] = results.map((resource) => ({
      kind: "res",
      resource,
    }));
    if (urlLike) return [{ kind: "add", url: urlLike }, ...res];
    return res;
  }, [results, urlLike]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    // focus après le montage ; annulé si la palette se ferme avant
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset declenche par chaque frappe, setter stable
  useEffect(() => setSelected(0), [query]);

  /** Extrait ~60 caractères autour du terme cherché (description ou notes),
   *  pour que la palette montre OU elle a trouvé. */
  function snippetOf(r: Resource): string | null {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    for (const field of [r.description, r.notes]) {
      if (!field) continue;
      const i = field.toLowerCase().indexOf(q);
      if (i === -1) continue;
      const start = Math.max(0, i - 24);
      const end = Math.min(field.length, i + q.length + 36);
      return (
        (start > 0 ? "…" : "") +
        field.slice(start, end).replace(/\s+/g, " ").trim() +
        (end < field.length ? "…" : "")
      );
    }
    return null;
  }

  async function launch(r: Resource) {
    try {
      await openResource(r);
      void qc.invalidateQueries({ queryKey: ["resources"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function addUrl(url: string) {
    if (adding) return;
    setAdding(true);
    try {
      // titre + favicon récupérés si le site répond, sinon on ajoute quand même
      const m = await fetchMetadata(url).catch(() => null);
      await addResource({
        url,
        title: m?.title || hostOf(url) || "Sans titre",
        favicon: m?.favicon ?? "",
        resourceType: "site",
      });
      toast.success(t("Ajouté à la bibliothèque ✓"));
      void qc.invalidateQueries({ queryKey: ["resources"] });
      onOpenChange(false);
    } catch (e) {
      const msg = describeError(e);
      toast.error(
        msg.includes("déjà enregistrée") ? t("Déjà dans ta bibliothèque") : msg,
      );
    } finally {
      setAdding(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-fade-in items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Palette de commandes")}
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        // focus trap : Tab ne doit pas fuir vers la page derrière (modale
        // maison hors Base UI). La palette n'a que l'input + les résultats :
        // contenir Tab dans le conteneur suffit, Échap ferme déjà.
        onKeyDown={(e) => {
          if (e.key === "Tab") e.preventDefault();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder={t(
              "Rechercher une ressource — ou coller une URL à ajouter…",
            )}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-0 dark:bg-transparent"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = items[selected];
                if (it?.kind === "add") void addUrl(it.url);
                else if (it?.kind === "res") void launch(it.resource);
              } else if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Échap
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {query ? t("Aucun résultat") : t("Tape pour rechercher")}
            </p>
          ) : (
            items.map((it, i) =>
              it.kind === "add" ? (
                <button
                  key={`add:${it.url}`}
                  type="button"
                  onClick={() => void addUrl(it.url)}
                  onMouseEnter={() => setSelected(i)}
                  disabled={adding}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none",
                    i === selected ? "bg-accent" : "",
                    adding && "opacity-60",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/15 text-primary">
                    <Plus className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t("Ajouter « {host} » à la bibliothèque", {
                      host: hostOf(it.url),
                    })}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Entrée ↵
                  </span>
                </button>
              ) : (
                (() => {
                  const r = it.resource;
                  const snip = snippetOf(r);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => void launch(r)}
                      onMouseEnter={() => setSelected(i)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none",
                        i === selected ? "bg-accent" : "",
                      )}
                    >
                      {r.favicon ? (
                        <img
                          src={r.favicon}
                          alt=""
                          className="size-6 rounded"
                        />
                      ) : (
                        <div className="flex size-6 items-center justify-center rounded bg-muted text-[10px] font-bold uppercase">
                          {r.title.slice(0, 2)}
                        </div>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{r.title}</span>
                        {snip && (
                          <span className="truncate text-xs text-muted-foreground">
                            {snip}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {typeLabel(r.resourceType)} · {hostOf(r.url)}
                      </span>
                      {i === selected && (
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })()
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
