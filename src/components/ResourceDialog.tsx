import { useQuery } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronLeft,
  FileInput,
  ImagePlus,
  LayoutGrid,
  Lightbulb,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import {
  addResource,
  fetchRepoDetails,
  isUrlKnown,
  listResources,
  type RepoDetails,
  readImageDataUrl,
  sniffResource,
  updateResource,
} from "@/lib/api";
import { metaFieldsFor } from "@/lib/metaFields";
import { hostOf, RESOURCE_TYPES } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import { detectTypeForUrl, urlSpecFor } from "@/lib/urlSpec";
import { cn, describeError } from "@/lib/utils";

// liste des 3459 logos chargée à la demande : hors du bundle principal,
// le chunk ne part que quand l'utilisateur ouvre la bibliothèque
const IconLibraryDialog = lazy(() =>
  import("@/components/IconLibraryDialog").then((m) => ({
    default: m.IconLibraryDialog,
  })),
);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Resource | null;
  /** URL capturée (presse-papiers) à pré-remplir */
  prefillUrl?: string | null;
  /** dossier courant : une NOUVELLE ressource y est rangée directement */
  initialFolderId?: number | null;
  /** doublon détecté : naviguer vers la ressource existante */
  onShowExisting: (res: Resource) => void;
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

/** Étape 1 : choix du type — descriptifs courts sous chaque carte. */
const TYPE_DESCS: Record<string, string> = {
  site: "Page web à garder",
  app: "Logiciel à lancer",
  repo: "GitHub, GitLab…",
  outil: "Service en ligne",
  article: "À lire, doc…",
  video: "YouTube, Twitch…",
  fichier: "Fichier du PC",
  autre: "Tout le reste",
};

type Step = "type" | "form";

export function ResourceDialog({
  open,
  onOpenChange,
  editing,
  prefillUrl,
  initialFolderId,
  onShowExisting,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [favicon, setFavicon] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>("type");
  // champs spécifiques repliés par défaut à la création (zéro scroll),
  // dépliés en édition (les valeurs existantes restent visibles)
  const [metaOpen, setMetaOpen] = useState(false);
  // bibliothèque d'icônes (Simple Icons) pour les paresseux
  const [libraryOpen, setLibraryOpen] = useState(false);
  // Smart Clip : renifler une fois par URL ; ne jamais écraser un choix
  // explicite de l'utilisateur (type / icône).
  const sniffedFor = useRef("");
  const touchedType = useRef(false);
  const touchedIcon = useRef(false);

  const spec = urlSpecFor(form.resourceType);
  const isApp = !!spec.isExe;
  const isFile = !!spec.isFile;
  const metaFields = metaFieldsFor(form.resourceType);
  const typeEntry =
    RESOURCE_TYPES.find((t) => t.value === form.resourceType) ??
    RESOURCE_TYPES[0];
  const filledMetaCount = metaFields.filter((f) =>
    form.meta[f.key]?.trim(),
  ).length;

  useEffect(() => {
    if (open) {
      // Smart Clip / garde des choix : repart à blanc à chaque ouverture
      sniffedFor.current = "";
      touchedType.current = false;
      touchedIcon.current = false;
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
        // édition : le type est connu, direct au formulaire
        setStep("form");
        setMetaOpen(true);
      } else {
        setForm(prefillUrl ? { ...EMPTY, url: prefillUrl } : EMPTY);
        setFavicon("");
        setMetaOpen(false);
        // capture presse-papiers : dépôt ou vidéo détecté → direct au
        // formulaire ; ajout vierge ou lien générique → choix du type
        const detected = prefillUrl ? detectTypeForUrl(prefillUrl) : null;
        if (detected) {
          setForm((f) => ({ ...f, resourceType: detected }));
          setStep("form");
        } else {
          setStep("type");
        }
        // pas de fetch ici : l'effet « Smart Clip » (débouncedUrl → sniff)
        // pré-remplit titre/description/image/tags une fois l'URL stabilisée.
      }
    }
    // deps exhaustives : setForm/setFavicon sont des setters stables
  }, [open, editing, prefillUrl]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setMeta(key: string, value: string) {
    setForm((f) => ({ ...f, meta: { ...f.meta, [key]: value } }));
  }

  /** Étape 1 → 2 : le type choisi, l'écran bascule vers ses options. */
  function pickType(value: string) {
    touchedType.current = true;
    set("resourceType", value);
    setStep("form");
  }

  async function chooseIcon() {
    try {
      const file = await openFileDialog({
        multiple: false,
        title: "Choisir une icône",
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico", "svg"],
          },
        ],
      });
      if (typeof file === "string") {
        touchedIcon.current = true;
        setFavicon(await readImageDataUrl(file));
        toast.success("Icône personnalisée appliquée");
      }
    } catch (e) {
      toast.error(describeError(e));
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
      toast.error(describeError(e));
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
      toast.error(describeError(e));
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
      if (
        form.resourceType === "repo" &&
        /github\.com\/[^/]+\/[^/]/.test(url)
      ) {
        const d = await fetchRepoDetails(url);
        applyRepoDetails(d);
        toast.success("Fiche du dépôt récupérée depuis GitHub");
        return;
      }
      // Smart Clip manuel : re-renifle (forcer après une modif du champ) et
      // complète titre/description/tags/type/image encore vides.
      sniffedFor.current = url;
      const s = await sniffResource(url);
      touchedType.current = false;
      touchedIcon.current = false;
      setForm((f) => ({
        ...f,
        resourceType: s.resourceType || f.resourceType,
        title: f.title.trim() ? f.title : s.title,
        description: f.description.trim() ? f.description : s.description,
        tags: f.tags.trim() ? f.tags : s.tags.join(", "),
      }));
      setFavicon((cur) => cur || s.image);
      toast.success("Infos récupérées automatiquement");
    } catch (e) {
      toast.error(describeError(e));
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
        stars: d.stars
          ? String(d.stars.toLocaleString("fr-FR"))
          : f.meta.stars || "",
        license: d.license || f.meta.license || "",
        topics: d.topics.length > 0 ? d.topics.join(", ") : f.meta.topics || "",
      },
      // topics officiels proposés en tags (sans écraser une saisie)
      tags: f.tags.trim() ? f.tags : d.topics.slice(0, 4).join(", "),
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

  // favicon du site proposé en un clic (sans passer par « Récupérer »)
  const faviconSuggest = useMemo(() => {
    try {
      const u = new URL(form.url.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;
    } catch {
      return null;
    }
  }, [form.url]);

  // URL anti-rebond pour la détection de doublon (évite un invoke par frappe)
  const [debouncedUrl, setDebouncedUrl] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(form.url), 400);
    return () => clearTimeout(t);
  }, [form.url]);

  // Smart Clip : une URL http stabilisée (création seule) → on renifle le type
  // et les méta riches, et on ne remplit QUE les champs encore vides, sans
  // jamais écraser un type/icône choisis à la main par l'utilisateur.
  useEffect(() => {
    if (!open || editing) return;
    const u = debouncedUrl.trim();
    if (!/^https?:\/\/.+\..+/i.test(u)) return;
    if (sniffedFor.current === u) return;
    sniffedFor.current = u;
    let cancelled = false;
    void (async () => {
      try {
        const s = await sniffResource(u);
        if (cancelled || sniffedFor.current !== u) return;
        setForm((f) => ({
          ...f,
          resourceType: touchedType.current
            ? f.resourceType
            : s.resourceType || f.resourceType,
          title: f.title.trim() ? f.title : s.title,
          description: f.description.trim() ? f.description : s.description,
          tags: f.tags.trim() ? f.tags : s.tags.join(", "),
        }));
        if (!touchedIcon.current) {
          setFavicon((cur) => cur || s.image);
        }
      } catch {
        /* silencieux : « Récupérer » reste dispo pour réessayer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing, debouncedUrl]);

  // doublon exact : le backend refuse l'URL à la sauvegarde — on prévient
  // avant, avec renvoi vers l'item existant. `true` = connu (création) mais
  // non résolu par la recherche. En ÉDITION, l'URL courante est légitimement
  // en base (c'est CETTE ligne) : seule une AUTRE ressource (id différent)
  // portant la même URL compte comme doublon — sinon faux positif à chaque
  // clic sur « Modifier ».
  const { data: duplicate } = useQuery({
    queryKey: ["resources", "duplicate", debouncedUrl, editing?.id],
    queryFn: async (): Promise<Resource | true | null> => {
      const u = debouncedUrl.trim();
      if (!u || isApp || isFile || !u.startsWith("http")) return null;
      const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "");
      const list = await listResources({ query: u, limit: 20 });
      const match = list.find(
        (r) => r.id !== editing?.id && norm(r.url) === norm(u),
      );
      if (match) return match;
      // création seule : le backend peut connaître une variante canonique
      // (www. / slash / utm_) que la recherche LIKE ne ressors pas
      if (!editing && (await isUrlKnown(u))) return true;
      return null;
    },
    enabled: step === "form" && !!debouncedUrl.trim(),
    staleTime: 30_000,
  });

  const canSave =
    form.title.trim() !== "" &&
    (!isFile || !!form.meta.filePath?.trim()) &&
    // le backend refuse les URL en double : on bloque net (sauf si l'unique
    // correspondance est la ressource en cours d'édition → duplicate = null)
    !duplicate;

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
      .filter((r) => r.id !== editing?.id && hostOf(r.url) === similarHost)
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
    if (isFile && form.meta.filePath?.trim())
      meta.filePath = form.meta.filePath.trim();
    else if (isFile) delete meta.filePath;

    const payload = {
      url: isFile && !form.url.trim() ? "" : form.url.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      resourceType: form.resourceType,
      category: editing?.category ?? "",
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
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
      toast.error(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  const TypeIcon = typeEntry.icon;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            // filet de sécurité : ne scrolle qu'en fenêtre très petite avec
            // les détails dépliés — le parcours normal tient sans scroll
            "max-h-[88vh] overflow-y-auto",
            step === "type" ? "sm:max-w-md" : "sm:max-w-lg",
          )}
        >
          <DialogHeader>
            <div className="flex items-center gap-2 pr-6">
              {/* pastille type : retour à l'étape 1 en un clic */}
              {step === "form" && (
                <button
                  type="button"
                  onClick={() => setStep("type")}
                  title="Changer de type de ressource"
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pr-2.5 pl-1 text-xs font-medium text-primary transition-colors outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <ChevronLeft className="size-4" />
                  <TypeIcon className="size-3.5" />
                  {typeEntry.label}
                </button>
              )}
              <DialogTitle>
                {editing ? "Modifier la ressource" : "Nouvelle ressource"}
              </DialogTitle>
            </div>
            {step === "type" && (
              <p className="text-sm text-muted-foreground">
                Que veux-tu ajouter ? Choisis un type pour continuer.
              </p>
            )}
          </DialogHeader>

          {step === "type" ? (
            /* ---- Étape 1 : cartes des types de ressources ---- */
            <div className="grid animate-fade-in grid-cols-2 gap-2 sm:grid-cols-4">
              {RESOURCE_TYPES.filter((t) => t.value !== "note").map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => pickType(t.value)}
                  className="group flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border bg-card px-2 py-3.5 text-center transition-all outline-none hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <t.icon className="size-5" />
                  </span>
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {TYPE_DESCS[t.value] ?? ""}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            /* ---- Étape 2 : options du type choisi (compact, sans scroll) ---- */
            <>
              <div className="grid animate-fade-in gap-3">
                {/* champ principal adapté au type */}
                {isFile ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="filepath">{spec.primaryLabel}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="filepath"
                        placeholder={spec.primaryPlaceholder}
                        value={form.meta.filePath ?? ""}
                        onChange={(e) => setMeta("filePath", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void chooseLocalFile()}
                      >
                        Parcourir…
                      </Button>
                    </div>
                    {spec.hint && (
                      <p className="text-xs text-muted-foreground">
                        {spec.hint}
                      </p>
                    )}
                  </div>
                ) : isApp ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="exe">{spec.primaryLabel}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="exe"
                        placeholder={spec.primaryPlaceholder}
                        value={form.meta.exePath ?? ""}
                        onChange={(e) => setMeta("exePath", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        onClick={() => void chooseExecutable()}
                      >
                        <FileInput />
                        Parcourir…
                      </Button>
                    </div>
                    {spec.hint && (
                      <p className="text-xs text-muted-foreground">
                        {spec.hint}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-1.5">
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
                          <Sparkles
                            className={fetching ? "animate-pulse" : ""}
                          />
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
                        <p className="text-xs text-muted-foreground">
                          {spec.hint}
                        </p>
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
                    {/* URL exacte déjà enregistrée : renvoi vers l'existant */}
                    {duplicate && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                        <div className="min-w-0 flex-1 text-xs">
                          <span className="font-medium">
                            Cette URL est déjà dans ta bibliothèque
                            {typeof duplicate === "object" &&
                              ` : ${duplicate.title}`}
                          </span>
                          {typeof duplicate === "object" && (
                            <>
                              {" · "}
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenChange(false);
                                  onShowExisting(duplicate);
                                }}
                                className="cursor-pointer font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              >
                                Voir la ressource
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* site web optionnel pour une app */}
                {isApp && (
                  <div className="grid gap-1.5">
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

                {/* icône : aperçu + choix manuel + favicon du site en un clic */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
                    {favicon ? (
                      <img
                        src={favicon}
                        alt=""
                        className="size-full object-contain"
                      />
                    ) : (
                      <ImagePlus className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void chooseIcon()}
                  >
                    <ImagePlus />
                    Icône…
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLibraryOpen(true)}
                    title="Choisir parmi des milliers d'icônes : logos d'apps et icônes génériques"
                  >
                    <LayoutGrid />
                    Bibliothèque…
                  </Button>
                  {favicon && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        touchedIcon.current = true;
                        setFavicon("");
                      }}
                      title="Retirer l'icône personnalisée"
                    >
                      <RotateCcw />
                      Réinitialiser
                    </Button>
                  )}
                  {faviconSuggest && (
                    <button
                      type="button"
                      onClick={() => {
                        touchedIcon.current = true;
                        setFavicon(faviconSuggest);
                      }}
                      title="Utiliser le favicon du site (clic = appliquer)"
                      className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-muted/30 p-1.5 transition-colors outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <img
                        src={faviconSuggest}
                        alt=""
                        className="size-full object-contain"
                      />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="title">Titre *</Label>
                    <Input
                      id="title"
                      value={form.title}
                      onChange={(e) => set("title", e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="tags">Tags (virgules)</Label>
                    <Input
                      id="tags"
                      placeholder="design, gratuit, ia"
                      value={form.tags}
                      onChange={(e) => set("tags", e.target.value)}
                    />
                  </div>
                </div>

                {/* champs spécifiques au type, repliés par défaut */}
                {metaFields.length > 0 && (
                  <div className="rounded-lg border bg-muted/30">
                    <button
                      type="button"
                      onClick={() => setMetaOpen((o) => !o)}
                      aria-expanded={metaOpen}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          metaOpen && "rotate-180",
                        )}
                      />
                      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {typeEntry.label} — détails
                      </span>
                      {filledMetaCount > 0 && (
                        <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
                          {filledMetaCount}
                        </span>
                      )}
                    </button>
                    {metaOpen && (
                      <div className="grid animate-fade-in gap-3 px-3 pb-3 sm:grid-cols-2">
                        {metaFields.map((f) => (
                          <div key={f.key} className="grid gap-1.5">
                            <Label
                              htmlFor={`meta-${f.key}`}
                              className="text-sm"
                            >
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
                    )}
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    placeholder="Une phrase pour t'en souvenir"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <div className="mr-auto flex items-center gap-2 self-center">
                  <Switch
                    id="favorite"
                    checked={form.favorite}
                    onCheckedChange={(v) => set("favorite", v)}
                  />
                  <Label htmlFor="favorite">Favori</Label>
                </div>
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
            </>
          )}
        </DialogContent>
      </Dialog>
      {/* sélecteur en dialogue frère (pas imbriqué) pour un empilement sain */}
      {libraryOpen && (
        <Suspense fallback={null}>
          <IconLibraryDialog
            open={libraryOpen}
            onOpenChange={setLibraryOpen}
            onPick={(dataUrl) => {
              touchedIcon.current = true;
              setFavicon(dataUrl);
              toast.success("Icône appliquée");
            }}
          />
        </Suspense>
      )}
    </>
  );
}
