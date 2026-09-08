import { FileInput, ImagePlus, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  addResource,
  fetchMetadata,
  fetchRepoDetails,
  listResources,
  readImageDataUrl,
  updateResource,
  type RepoDetails,
} from "@/lib/api";
import { metaFieldsFor } from "@/lib/metaFields";
import { hostOf, RESOURCE_TYPES } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import { urlSpecFor } from "@/lib/urlSpec";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Resource | null;
  /** URL capturée (presse-papiers) à pré-remplir */
  prefillUrl?: string | null;
  /** dossier courant : une NOUVELLE ressource y est rangée directement */
  initialFolderId?: number | null;
  onSaved: () => void;
}

interface FormState {
  /** URL web : champ principal (sauf app) ou site web optionnel (app) */
  url: string;
  title: string;
  description: string;
  resourceType: string;
  tags: string;
  favorite: boolean;
  meta: Record<string, string>;
}

const EMPTY: FormState = {
  url: "",
  title: "",
  description: "",
  resourceType: "site",
  tags: "",
  favorite: false,
  meta: {},
};

export function ResourceDialog({
  open,
  onOpenChange,
  editing,
  prefillUrl,
  initialFolderId,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [favicon, setFavicon] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const spec = urlSpecFor(form.resourceType);
  const isApp = !!spec.isExe;
  const isFile = !!spec.isFile;
  const metaFields = metaFieldsFor(form.resourceType);

  useEffect(() => {
    if (open) {
      if (editing) {
        // une app stockée a url = "exe:…" : on remet le chemin dans meta.exePath
        const meta = { ...(editing.meta ?? {}) };
        let url = editing.url;
        if (editing.resourceType === "app" && url.startsWith("exe:")) {
          meta.exePath = meta.exePath ?? url.slice(4);
          url = "";
        }
        setForm({
          url,
          title: editing.title,
          description: editing.description,
          resourceType: editing.resourceType,
          tags: editing.tags.join(", "),
          favorite: editing.favorite,
          meta,
        });
        setFavicon(editing.favicon);
      } else {
        setForm(prefillUrl ? { ...EMPTY, url: prefillUrl } : EMPTY);
        setFavicon("");
        if (prefillUrl) {
          void (async () => {
            try {
              const m = await fetchMetadata(prefillUrl);
              setForm((f) => (f.title.trim() ? f : { ...f, title: m.title }));
              setFavicon(m.favicon);
            } catch {
              /* silencieux */
            }
          })();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, prefillUrl]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setMeta(key: string, value: string) {
    setForm((f) => ({ ...f, meta: { ...f.meta, [key]: value } }));
  }

  async function chooseIcon() {
    try {
      const file = await openFileDialog({
        multiple: false,
        title: "Choisir une icône",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico", "svg"] },
        ],
      });
      if (typeof file === "string") {
        setFavicon(await readImageDataUrl(file));
        toast.success("Icône personnalisée appliquée");
      }
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function chooseExecutable() {
    try {
      const file = await openFileDialog({
        multiple: false,
        title: "Choisir l'exécutable",
        filters: [
          { name: "Exécutable", extensions: ["exe", "lnk", "bat"] },
          { name: "Tous les fichiers", extensions: ["*"] },
        ],
      });
      if (typeof file === "string") setMeta("exePath", file);
    } catch (e) {
      toast.error(String(e));
    }
  }

  /** Parcourir un fichier local (type Fichier). */
  async function chooseLocalFile() {
    try {
      const file = await openFileDialog({
        multiple: false,
        title: "Choisir un fichier",
        filters: [{ name: "Tous les fichiers", extensions: ["*"] }],
      });
      if (typeof file === "string") setMeta("filePath", file);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function autofill() {
    const url = form.url.trim();
    if (!url) {
      toast.error("Saisis d'abord un lien web");
      return;
    }
    setFetching(true);
    try {
      // dépôt GitHub : récupère la fiche complète (description, langage,
      // étoiles, topics, licence) au-delà du titre/favicon
      if (form.resourceType === "repo" && /github\.com\/[^/]+\/[^/]/.test(url)) {
        const d = await fetchRepoDetails(url);
        applyRepoDetails(d);
        toast.success("Fiche du dépôt récupérée depuis GitHub");
        return;
      }
      const m = await fetchMetadata(url);
      if (!form.title.trim()) set("title", m.title);
      if (!favicon) setFavicon(m.favicon);
      toast.success("Titre et favicon récupérés");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setFetching(false);
    }
  }

  /** Applique les détails GitHub au formulaire : titre par défaut, favicon
   *  GitHub, description, et les champs meta marqués « auto ». */
  function applyRepoDetails(d: RepoDetails) {
    setForm((f) => ({
      ...f,
      title: f.title.trim() ? f.title : d.name,
      description: f.description.trim() ? f.description : d.description,
      meta: {
        ...f.meta,
        language: d.language || f.meta.language || "",
        owner: d.owner || f.meta.owner || "",
        stars: d.stars ? String(d.stars.toLocaleString("fr-FR")) : f.meta.stars || "",
        license: d.license || f.meta.license || "",
        topics: d.topics.length > 0 ? d.topics.join(", ") : f.meta.topics || "",
      },
      // topics officiels proposés en tags (sans écraser une saisie)
      tags: f.tags.trim()
        ? f.tags
        : d.topics.slice(0, 4).join(", "),
    }));
    if (!favicon) {
      setFavicon(`https://github.com/${d.owner}.png?size=128`);
    }
  }

  // validation live du lien principal : simple conseil, ne bloque plus
  const urlHint = useMemo(() => {
    if (isApp || !form.url.trim()) return null;
    return spec.validate ? spec.validate(form.url) : null;
  }, [spec, form.url, isApp]);

  const canSave =
    form.title.trim() !== "" &&
    (!isFile || !!form.meta.filePath?.trim());

  // liens similaires déjà enregistrés sur le même domaine
  const similarHost = useMemo(() => {
    if (isApp) return null;
    const u = form.url.trim();
    if (!u.startsWith("http")) return null;
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      return h || null;
    } catch {
      return null;
    }
  }, [form.url, isApp]);

  const { data: similarList } = useQuery({
    queryKey: ["resources", "similar", similarHost],
    queryFn: () => listResources({ query: similarHost ?? "", limit: 30 }),
    enabled: !!similarHost,
    staleTime: 30_000,
  });

  const similar = useMemo(() => {
    if (!similarHost || !similarList) return [];
    return similarList
      .filter(
        (r) =>
          r.id !== editing?.id && hostOf(r.url) === similarHost,
      )
      .slice(0, 3);
  }, [similarList, similarHost, editing?.id]);

  async function save() {
    setSaving(true);
    // on repart des meta existantes : les clés hors META_FIELDS du type
    // courant (ex : exePath sur une ancienne app devenue « site ») doivent
    // survivre à l'édition, seules les clés saisies sont écrasées.
    const meta: Record<string, string> = { ...(editing?.meta ?? {}) };
    for (const f of metaFields) {
      const v = form.meta[f.key]?.trim();
      if (v) meta[f.key] = v;
      else delete meta[f.key];
    }
    if (isApp) {
      // symétrique de filePath : un exePath vidé dans le formulaire doit
      // disparaître des meta (sinon normalize_url régénère un « exe:… »)
      const exe = form.meta.exePath?.trim();
      if (exe) meta.exePath = exe;
      else delete meta.exePath;
    }
    if (isFile && form.meta.filePath?.trim()) meta.filePath = form.meta.filePath.trim();
    else if (isFile) delete meta.filePath;

    const payload = {
      url: isFile && !form.url.trim() ? "" : form.url.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      resourceType: form.resourceType,
      category: editing?.category ?? "",
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes: editing?.notes ?? "",
      favicon,
      favorite: form.favorite,
      status: editing?.status ?? "",
      // édition : garde son dossier ; création : dossier courant ouvert
      folderId: editing?.folderId ?? initialFolderId ?? null,
      meta,
    };
    try {
      if (editing) {
        await updateResource(editing.id, payload);
        toast.success("Ressource mise à jour");
      } else {
        await addResource(payload);
        toast.success("Ressource ajoutée");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Modifier la ressource" : "Nouvelle ressource"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {/* sélecteur de type en tête : tout le formulaire s'adapte */}
          <div className="grid gap-1.5">
            <Label>Type de ressource</Label>
            <div className="flex flex-wrap gap-1.5">
              {RESOURCE_TYPES.filter((t) => t.value !== "note").map((t) => (
                <button
                  key={t.value}
                  onClick={() => set("resourceType", t.value)}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    form.resourceType === t.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* champ principal adapté au type */}
          {isFile ? (
            <div className="grid gap-2">
              <Label htmlFor="filepath">{spec.primaryLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="filepath"
                  placeholder={spec.primaryPlaceholder}
                  value={form.meta.filePath ?? ""}
                  onChange={(e) => setMeta("filePath", e.target.value)}
                />
                <Button variant="outline" onClick={() => void chooseLocalFile()}>
                  Parcourir…
                </Button>
              </div>
              {spec.hint && (
                <p className="text-xs text-muted-foreground">{spec.hint}</p>
              )}
            </div>
          ) : isApp ? (
            <div className="grid gap-2">
              <Label htmlFor="exe">{spec.primaryLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="exe"
                  placeholder={spec.primaryPlaceholder}
                  value={form.meta.exePath ?? ""}
                  onChange={(e) => setMeta("exePath", e.target.value)}
                />
                <Button variant="outline" onClick={() => void chooseExecutable()}>
                  <FileInput />
                  Parcourir…
                </Button>
              </div>
              {spec.hint && (
                <p className="text-xs text-muted-foreground">{spec.hint}</p>
              )}
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="url">{spec.primaryLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="url"
                  placeholder={spec.primaryPlaceholder}
                  value={form.url}
                  onChange={(e) => set("url", e.target.value)}
                />
                {spec.showFetch && (
                  <Button
                    variant="outline"
                    onClick={() => void autofill()}
                    disabled={fetching}
                    title="Récupérer le titre et le favicon automatiquement"
                  >
                    <Sparkles className={fetching ? "animate-pulse" : ""} />
                    Récupérer
                  </Button>
                )}
              </div>
              {urlHint ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {urlHint}
                </p>
              ) : (
                spec.hint && (
                  <p className="text-xs text-muted-foreground">{spec.hint}</p>
                )
              )}
              {/* liens déjà enregistrés sur ce domaine */}
              {similar.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2">
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  <div className="min-w-0 text-xs">
                    <span className="font-medium">
                      Déjà enregistré sur {hostOf(similar[0].url)} :
                    </span>{" "}
                    {similar.map((r) => r.title).join(" · ")}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* site web optionnel pour une app */}
          {isApp && (
            <div className="grid gap-2">
              <Label htmlFor="appweb">{spec.secondaryLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id="appweb"
                  placeholder="https://…"
                  value={form.url}
                  onChange={(e) => set("url", e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => void autofill()}
                  disabled={fetching}
                  title="Récupérer le titre et le favicon depuis le site"
                >
                  <Sparkles className={fetching ? "animate-pulse" : ""} />
                  Récupérer
                </Button>
              </div>
            </div>
          )}

          {/* suggestion d'icône quand un lien web est saisi (128 px : net
              en tuile ET en vue Détails — 64 serait flou, 256 superflu) */}
          {form.url.trim().startsWith("http") && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">
                Icône suggérée pour ce site :
              </span>
              <div className="flex items-center gap-2">
                {(() => {
                  let src2 = "";
                  try {
                    const u = new URL(form.url.trim());
                    src2 = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;
                  } catch {
                    return null;
                  }
                  return (
                    <button
                      onClick={() => setFavicon(src2)}
                      title="Utiliser le favicon du site"
                      className="flex size-10 cursor-pointer items-center justify-center rounded-lg border bg-muted/30 p-1.5 transition-colors hover:border-primary/50"
                    >
                      <img src={src2} alt="" className="size-full object-contain" />
                    </button>
                  );
                })()}
                <span className="text-xs text-muted-foreground">
                  clic = appliquer comme icône
                </span>
              </div>
            </div>
          )}

          {/* icône personnalisée */}
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40">
              {favicon ? (
                <img src={favicon} alt="" className="size-full object-contain" />
              ) : (
                <ImagePlus className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="grid gap-1">
              <span className="text-sm font-medium">Icône</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void chooseIcon()}>
                  <ImagePlus />
                  Choisir une image…
                </Button>
                {favicon && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFavicon("")}
                    title="Retirer l'icône personnalisée"
                  >
                    <RotateCcw />
                    Réinitialiser
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="title">Titre *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tags">Tags (séparés par des virgules)</Label>
              <Input
                id="tags"
                placeholder="ex : design, gratuit, ia"
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
              />
            </div>
          </div>

          {/* champs spécifiques au type */}
          {metaFields.length > 0 && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {RESOURCE_TYPES.find((t) => t.value === form.resourceType)?.label}
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                {metaFields.map((f) => (
                  <div key={f.key} className="grid gap-1.5">
                    <Label htmlFor={`meta-${f.key}`} className="text-sm">
                      {f.label}
                    </Label>
                    <Input
                      id={`meta-${f.key}`}
                      placeholder={f.placeholder}
                      value={form.meta[f.key] ?? ""}
                      onChange={(e) => setMeta(f.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="favorite"
              checked={form.favorite}
              onCheckedChange={(v) => set("favorite", v)}
            />
            <Label htmlFor="favorite">Favori</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !canSave}
          >
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
