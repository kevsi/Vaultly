import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  GitFork,
  Loader2,
  Pencil,
  Scale,
  Star,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { fetchRepoDetails } from "@/lib/api";
import { fileKindFor } from "@/lib/fileKind";
import { useI18n } from "@/lib/i18n";
import { metaFieldsFor } from "@/lib/metaFields";
import { openResource } from "@/lib/openResource";
import { parseDbDate, typeLabel } from "@/lib/resources";
import { isSafeLinkHref } from "@/lib/sanitize";
import type { Resource } from "@/lib/types";
import { describeError } from "@/lib/utils";

interface Props {
  resource: Resource | null;
  onClose: () => void;
  onEdit: (r: Resource) => void;
}

/** Mini-rendu Markdown pour un README : titres, gras/italique, code inline,
 *  blocs de code, listes, liens. Volontairement simple (aperçu de lecture),
 *  tout passe par l'échappement HTML avant l'ajout des balises. Le contenu
 *  vient de GitHub (entièrement distant) : on borne sa taille (perf/ReDoS) et
 *  on ne rend un lien que si son schéma est inoffensif (jamais javascript:…). */
function renderMarkdown(md: string): string {
  // README de plusieurs Mo = latence/regex coûteuse : plafond généreux.
  const capped =
    md.length > 200_000 ? Array.from(md).slice(0, 200_000).join("") : md;
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // blocs de code ``` extraits d'abord (le contenu doit rester brut)
  const codeBlocks: string[] = [];
  let text = capped.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(
      `<pre class="rounded-lg bg-muted/60 p-3 text-xs overflow-x-auto my-2"><code>${esc(code.trimEnd())}</code></pre>`,
    );
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  text = esc(text);

  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const inline = (s: string) =>
    s
      .replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-muted/60 px-1 py-0.5 text-[0.85em]">$1</code>',
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_full, label: string, href: string) =>
          isSafeLinkHref(href)
            ? `<a href="${href}" class="text-primary underline underline-offset-2">${label}</a>`
            : label,
      );

  for (const raw of lines) {
    const line = raw.trimEnd();
    // biome-ignore lint/suspicious/noControlCharactersInRegex: sentinelles NUL volontaires (blocs de code extraits)
    const codeMatch = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (codeMatch) {
      closeList();
      out.push(codeBlocks[Number(codeMatch[1])]);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const sizes = ["text-xl", "text-lg", "text-base", "text-sm"];
      out.push(
        `<h3 class="${sizes[h[1].length - 1]} font-bold mt-4 mb-1">${inline(h[2])}</h3>`,
      );
      continue;
    }
    const li = line.match(/^\s*[-*+]\s+(.*)/);
    if (li) {
      if (!inList) {
        out.push('<ul class="list-disc pl-5 space-y-0.5 my-1">');
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    out.push(`<p class="my-1.5">${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

function StatChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium">
      {icon}
      {label}
    </span>
  );
}

/** Vue « Détails » d'une ressource : toutes ses informations +, pour un
 *  dépôt GitHub, la fiche du repo (description, langage, stars, licence)
 *  et son README rendu en Markdown léger. */
export function ResourceDetails({ resource, onClose, onEdit }: Props) {
  const { t } = useI18n();
  // hooks AVANT tout return : `resource` passe de null à défini et
  // inversement, un return précoce avant les hooks casserait leur ordre
  // (erreur React « fewer hooks » à la fermeture de la fiche)
  const isRepo =
    !!resource &&
    resource.resourceType === "repo" &&
    /github\.com\/[^/]+\/[^/]/.test(resource.url);
  const { data: repo, isLoading: repoLoading } = useQuery({
    queryKey: ["repo-details", resource?.url],
    queryFn: () => fetchRepoDetails(resource?.url ?? ""),
    enabled: isRepo,
    staleTime: 60 * 60_000, // 1 h : les étoiles bougent lentement
    retry: 1,
  });

  if (!resource) return null;

  // fichier local : icône selon l'extension (pas d'initiales génériques)
  const isFileRes = resource.resourceType === "fichier";
  const kind = isFileRes ? fileKindFor(resource) : null;
  const KindIcon = kind?.icon;

  function copy(url: string) {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("URL copiée")))
      .catch(() => toast.error(t("Copie impossible")));
  }

  const created = parseDbDate(resource.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const opened = resource.openCount;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* hauteur adaptative : courte pour une petite ressource, plafonnée à
          85 vh pour un gros README. Un SEUL scroll (le corps) : l'en-tête
          reste fixe, plus d'ascenseur interne sur le README. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {/* en-tête figé : icône, titre, type, actions (pr-12 : place pour le ✕) */}
        <div className="flex items-start gap-3 border-b px-6 py-4 pr-12">
          {resource.favicon && !isFileRes ? (
            <img
              src={resource.favicon}
              alt=""
              className="size-12 shrink-0 rounded-xl border object-contain p-1"
            />
          ) : KindIcon ? (
            <div
              className={`flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted ${kind?.className ?? "text-muted-foreground"}`}
            >
              <KindIcon className="size-6" />
            </div>
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-muted text-lg font-bold uppercase text-muted-foreground">
              {resource.title.slice(0, 2)}
            </div>
          )}
          <div className="min-w-0 grow">
            <h2 className="text-xl font-bold leading-tight">
              {resource.title}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {typeLabel(resource.resourceType)} ·{" "}
              {t("ajoutée le {date}", { date: created })} ·{" "}
              {opened > 0
                ? t("ouverte {count} fois", { count: opened })
                : t("jamais ouverte")}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("Copier l'URL")}
              onClick={() => copy(resource.url)}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t("Modifier")}
              onClick={() => {
                onClose();
                onEdit(resource);
              }}
            >
              <Pencil />
            </Button>
            {!resource.url.startsWith("local:") && (
              <Button
                size="icon-sm"
                title={t("Ouvrir")}
                // même chemin que le clic sur la tuile : gère exe:, file:,
                // filePath et compte l'ouverture (l'ancien openUrl direct
                // échouait sur les apps et ne comptait jamais l'ouverture)
                onClick={() =>
                  openResource(resource).catch((e) =>
                    toast.error(describeError(e)),
                  )
                }
              >
                <ExternalLink />
              </Button>
            )}
          </div>
        </div>

        {/* corps : unique zone scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* lien */}
          {!resource.url.startsWith("local:") && (
            <button
              type="button"
              onClick={() => copy(resource.url)}
              title={t("Cliquer pour copier")}
              className="flex w-full cursor-pointer items-center gap-2 truncate rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5 shrink-0" />
              <span className="truncate">{resource.url}</span>
            </button>
          )}

          {/* description */}
          {resource.description && (
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">
              {resource.description}
            </p>
          )}

          {/* tags + favori */}
          {(resource.tags.length > 0 || resource.favorite) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {resource.favorite && (
                <StatChip
                  icon={
                    <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
                  }
                  label={t("Favori")}
                />
              )}
              {resource.tags.map((t) => (
                <StatChip
                  key={t}
                  icon={<Tag className="size-3.5 text-muted-foreground" />}
                  label={t}
                />
              ))}
            </div>
          )}

          {/* champs meta du type */}
          {metaFieldsFor(resource.resourceType).some(
            (f) => resource.meta?.[f.key],
          ) && (
            <div className="mt-3 grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
              {metaFieldsFor(resource.resourceType)
                .filter((f) => resource.meta?.[f.key])
                .map((f) => (
                  <div key={f.key}>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </span>
                    <p className="text-sm">{resource.meta?.[f.key] ?? ""}</p>
                  </div>
                ))}
            </div>
          )}

          {/* fiche GitHub */}
          {isRepo && (
            <div className="mt-3 rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="size-4 text-muted-foreground" />
                {t("Dépôt GitHub")}
              </div>
              {repoLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("Interrogation de GitHub…")}
                </div>
              ) : repo ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {repo.language && (
                      <StatChip
                        icon={
                          <span className="size-2.5 rounded-full bg-primary" />
                        }
                        label={repo.language}
                      />
                    )}
                    <StatChip
                      icon={<Star className="size-3.5" />}
                      label={repo.stars.toLocaleString("fr-FR")}
                    />
                    <StatChip
                      icon={<GitFork className="size-3.5" />}
                      label={repo.forks.toLocaleString("fr-FR")}
                    />
                    {repo.license && (
                      <StatChip
                        icon={<Scale className="size-3.5" />}
                        label={repo.license}
                      />
                    )}
                  </div>
                  {repo.topics.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {repo.topics.slice(0, 8).map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {repo.description && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {repo.description}
                    </p>
                  )}
                  {/* README : suit le flux du corps, PAS de scroll interne */}
                  {repo.readme ? (
                    <div className="mt-3 border-t pt-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <FileText className="size-3.5" />
                        README
                      </div>
                      {/* liens du README : ouverts dans le navigateur externe,
                          jamais en navigation de la webview (hameçonnage/DoS).
                          Les href dangereux sont déjà neutralisés par
                          renderMarkdown ; ceci est la défense en profondeur. */}
                      <div
                        className="note-content text-sm"
                        onClick={(e) => {
                          const anchor = (e.target as HTMLElement).closest("a");
                          const href = anchor?.getAttribute("href");
                          if (!href) return;
                          e.preventDefault();
                          if (/^https?:\/\//i.test(href)) {
                            void openUrl(href).catch(() => {});
                          }
                        }}
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(repo.readme),
                        }}
                      />
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t("Pas de README sur ce dépôt.")}
                    </p>
                  )}
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  {t("Détails indisponibles (quota GitHub ou dépôt privé).")}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
