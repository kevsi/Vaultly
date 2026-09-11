import { useQuery } from "@tanstack/react-query";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ChevronLeft } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type FormState,
  ResourceFormFields,
} from "@/components/resource/ResourceFormFields";
import { ResourceTypePicker } from "@/components/resource/ResourceTypePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useI18n } from "@/lib/i18n";
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

const EMPTY: FormState = {
  url: "",
  title: "",
  description: "",
  resourceType: "site",
  tags: "",
  favorite: false,
  meta: {},
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
  const { t } = useI18n();
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
        title: t("Choisir une icône"),
        filters: [
          {
            name: t("Images"),
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "ico", "svg"],
          },
        ],
      });
      if (typeof file === "string") {
        touchedIcon.current = true;
        setFavicon(await readImageDataUrl(file));
        toast.success(t("Icône personnalisée appliquée"));
      }
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function chooseExecutable() {
    try {
      const file = await openFileDialog({
        multiple: false,
        title: t("Choisir l'exécutable"),
        filters: [
          { name: t("Exécutable"), extensions: ["exe", "lnk", "bat"] },
          { name: t("Tous les fichiers"), extensions: ["*"] },
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
        title: t("Choisir un fichier"),
        filters: [{ name: t("Tous les fichiers"), extensions: ["*"] }],
      });
      if (typeof file === "string") setMeta("filePath", file);
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function autofill() {
    const url = form.url.trim();
    if (!url) {
      toast.error(t("Saisis d'abord un lien web"));
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
        toast.success(t("Fiche du dépôt récupérée depuis GitHub"));
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
      toast.success(t("Infos récupérées automatiquement"));
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

  // liens similaires déjà enregistrés sur le même domaine. Inutile pour les
  // plateformes vidéo : chaque lien est une vidéo distincte, et le bloc
  // « déjà enregistré sur youtube.com » pour chaque nouvel ajout était lu à
  // tort comme un refus (le vrai doublon, lui, passe par `duplicate`).
  const similarHost = useMemo(() => {
    if (isApp) return null;
    const u = form.url.trim();
    if (!u.startsWith("http")) return null;
    try {
      const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      if (!h) return null;
      const videoHosts = [
        "youtube.com",
        "youtu.be",
        "yt.be",
        "tiktok.com",
        "vimeo.com",
        "dailymotion.com",
        "dai.ly",
        "twitch.tv",
        "peertube.tv",
      ];
      if (
        videoHosts.some(
          (v) => h === v || h.endsWith(`.${v}`) || h === v.replace(/^m\./, ""),
        )
      ) {
        return null;
      }
      return h;
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
        toast.success(t("Ressource mise à jour"));
      } else {
        await addResource(payload);
        toast.success(t("Ressource ajoutée"));
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
                  title={t("Changer de type de ressource")}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pr-2.5 pl-1 text-xs font-medium text-primary transition-colors outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <ChevronLeft className="size-4" />
                  <TypeIcon className="size-3.5" />
                  {t(typeEntry.label)}
                </button>
              )}
              <DialogTitle>
                {editing ? t("Modifier la ressource") : t("Nouvelle ressource")}
              </DialogTitle>
            </div>
            {step === "type" && (
              <p className="text-sm text-muted-foreground">
                {t("Que veux-tu ajouter ? Choisis un type pour continuer.")}
              </p>
            )}
          </DialogHeader>

          {step === "type" ? (
            /* ---- Étape 1 : cartes des types de ressources ---- */
            <ResourceTypePicker onPick={pickType} />
          ) : (
            /* ---- Étape 2 : options du type choisi (compact, sans scroll) ---- */
            <>
              <ResourceFormFields
                form={form}
                set={set}
                setMeta={setMeta}
                spec={spec}
                metaFields={metaFields}
                typeEntry={typeEntry}
                metaOpen={metaOpen}
                onToggleMetaOpen={() => setMetaOpen((o) => !o)}
                filledMetaCount={filledMetaCount}
                favicon={favicon}
                faviconSuggest={faviconSuggest}
                onChooseIcon={() => void chooseIcon()}
                onOpenIconLibrary={() => setLibraryOpen(true)}
                onRemoveIcon={() => {
                  touchedIcon.current = true;
                  setFavicon("");
                }}
                onSuggestIcon={(dataUrl) => {
                  touchedIcon.current = true;
                  setFavicon(dataUrl);
                }}
                urlHint={urlHint}
                fetching={fetching}
                onFetch={() => void autofill()}
                onChooseLocalFile={() => void chooseLocalFile()}
                onChooseExecutable={() => void chooseExecutable()}
                similar={similar}
                duplicate={duplicate ?? null}
                onShowExisting={onShowExisting}
                onDismissDuplicate={() => onOpenChange(false)}
              />
              <DialogFooter>
                <div className="mr-auto flex items-center gap-2 self-center">
                  <Switch
                    id="favorite"
                    checked={form.favorite}
                    onCheckedChange={(v) => set("favorite", v)}
                  />
                  <Label htmlFor="favorite">{t("Favori")}</Label>
                </div>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("Annuler")}
                </Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving || !canSave}
                >
                  {editing ? t("Enregistrer") : t("Ajouter")}
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
              toast.success(t("Icône appliquée"));
            }}
          />
        </Suspense>
      )}
    </>
  );
}
