import { ChevronDown, FileInput, Lightbulb, Sparkles } from "lucide-react";
import { DuplicateWarning } from "@/components/resource/DuplicateWarning";
import { IconPickerButtons } from "@/components/resource/IconPickerButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import type { metaFieldsFor } from "@/lib/metaFields";
import { hostOf, type RESOURCE_TYPES } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import type { urlSpecFor } from "@/lib/urlSpec";
import { cn } from "@/lib/utils";

type UrlSpec = ReturnType<typeof urlSpecFor>;
type MetaField = ReturnType<typeof metaFieldsFor>[number];
type ResourceTypeEntry = (typeof RESOURCE_TYPES)[number];

export interface FormState {
  /** URL web : champ principal (sauf app) ou site web optionnel (app) */
  url: string;
  title: string;
  description: string;
  resourceType: string;
  tags: string;
  favorite: boolean;
  meta: Record<string, string>;
}

interface Props {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  setMeta: (key: string, value: string) => void;
  /** spécification du champ principal selon le type choisi */
  spec: UrlSpec;
  /** champs spécifiques au type (stockés dans meta) */
  metaFields: MetaField[];
  typeEntry: ResourceTypeEntry;
  metaOpen: boolean;
  onToggleMetaOpen: () => void;
  filledMetaCount: number;
  favicon: string;
  /** favicon du site proposé en un clic (sans passer par « Récupérer ») */
  faviconSuggest: string | null;
  onChooseIcon: () => void;
  onOpenIconLibrary: () => void;
  onRemoveIcon: () => void;
  onSuggestIcon: (dataUrl: string) => void;
  /** conseil de validation live du lien principal */
  urlHint: string | null;
  fetching: boolean;
  onFetch: () => void;
  onChooseLocalFile: () => void;
  onChooseExecutable: () => void;
  /** liens similaires déjà enregistrés sur le même domaine */
  similar: Resource[];
  /** URL exacte déjà enregistrée : ressource existante ou `true` */
  duplicate: Resource | true | null;
  onShowExisting: (res: Resource) => void;
  onDismissDuplicate: () => void;
}

/** Étape 2 : options du type choisi (compact, sans scroll). */
export function ResourceFormFields({
  form,
  set,
  setMeta,
  spec,
  metaFields,
  typeEntry,
  metaOpen,
  onToggleMetaOpen,
  filledMetaCount,
  favicon,
  faviconSuggest,
  onChooseIcon,
  onOpenIconLibrary,
  onRemoveIcon,
  onSuggestIcon,
  urlHint,
  fetching,
  onFetch,
  onChooseLocalFile,
  onChooseExecutable,
  similar,
  duplicate,
  onShowExisting,
  onDismissDuplicate,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="grid animate-fade-in gap-3">
      {/* champ principal adapté au type */}
      {spec.isFile ? (
        <div className="grid gap-1.5">
          <Label htmlFor="filepath">{t(spec.primaryLabel)}</Label>
          <div className="flex gap-2">
            <Input
              id="filepath"
              placeholder={t(spec.primaryPlaceholder)}
              value={form.meta.filePath ?? ""}
              onChange={(e) => setMeta("filePath", e.target.value)}
            />
            <Button variant="outline" onClick={onChooseLocalFile}>
              {t("Parcourir…")}
            </Button>
          </div>
          {spec.hint && (
            <p className="text-xs text-muted-foreground">{t(spec.hint)}</p>
          )}
        </div>
      ) : spec.isExe ? (
        <div className="grid gap-1.5">
          <Label htmlFor="exe">{t(spec.primaryLabel)}</Label>
          <div className="flex gap-2">
            <Input
              id="exe"
              placeholder={t(spec.primaryPlaceholder)}
              value={form.meta.exePath ?? ""}
              onChange={(e) => setMeta("exePath", e.target.value)}
            />
            <Button variant="outline" onClick={onChooseExecutable}>
              <FileInput />
              {t("Parcourir…")}
            </Button>
          </div>
          {spec.hint && (
            <p className="text-xs text-muted-foreground">{t(spec.hint)}</p>
          )}
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="url">{t(spec.primaryLabel)}</Label>
          <div className="flex gap-2">
            <Input
              id="url"
              placeholder={t(spec.primaryPlaceholder)}
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
            />
            {spec.showFetch && (
              <Button
                variant="outline"
                onClick={onFetch}
                disabled={fetching}
                title={t("Récupérer le titre et le favicon automatiquement")}
              >
                <Sparkles className={fetching ? "animate-pulse" : ""} />
                {t("Récupérer")}
              </Button>
            )}
          </div>
          {urlHint ? (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {t(urlHint)}
            </p>
          ) : (
            spec.hint && (
              <p className="text-xs text-muted-foreground">{t(spec.hint)}</p>
            )
          )}
          {/* liens déjà enregistrés sur ce domaine (informatif — le vrai
              doublon, lui, bloque via DuplicateWarning) */}
          {similar.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-2">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <div className="min-w-0 text-xs">
                <span className="font-medium">
                  {t("Tu as déjà {count} lien(s) sur {host} :", {
                    count: similar.length,
                    host: hostOf(similar[0].url),
                  })}
                </span>{" "}
                {similar.map((r) => r.title).join(" · ")}
              </div>
            </div>
          )}
          {/* URL exacte déjà enregistrée : renvoi vers l'existant */}
          {duplicate && (
            <DuplicateWarning
              duplicate={duplicate}
              onDismiss={onDismissDuplicate}
              onShowExisting={onShowExisting}
            />
          )}
        </div>
      )}

      {/* site web optionnel pour une app */}
      {spec.isExe && (
        <div className="grid gap-1.5">
          <Label htmlFor="appweb">
            {spec.secondaryLabel && t(spec.secondaryLabel)}
          </Label>
          <div className="flex gap-2">
            <Input
              id="appweb"
              placeholder="https://…"
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
            />
            <Button
              variant="outline"
              onClick={onFetch}
              disabled={fetching}
              title={t("Récupérer le titre et le favicon depuis le site")}
            >
              <Sparkles className={fetching ? "animate-pulse" : ""} />
              {t("Récupérer")}
            </Button>
          </div>
        </div>
      )}

      {/* icône : aperçu + choix manuel + favicon du site en un clic */}
      <IconPickerButtons
        favicon={favicon}
        suggest={faviconSuggest}
        onChooseFile={onChooseIcon}
        onOpenLibrary={onOpenIconLibrary}
        onRemove={onRemoveIcon}
        onSuggest={onSuggestIcon}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="title">{t("Titre *")}</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tags">{t("Tags (virgules)")}</Label>
          <Input
            id="tags"
            placeholder={t("design, gratuit, ia")}
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
            onClick={onToggleMetaOpen}
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
              {t("{label} — détails", { label: t(typeEntry.label) })}
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
                  <Label htmlFor={`meta-${f.key}`} className="text-sm">
                    {t(f.label)}
                  </Label>
                  <Input
                    id={`meta-${f.key}`}
                    placeholder={f.placeholder && t(f.placeholder)}
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
        <Label htmlFor="description">{t("Description")}</Label>
        <Input
          id="description"
          placeholder={t("Une phrase pour t'en souvenir")}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
    </div>
  );
}
