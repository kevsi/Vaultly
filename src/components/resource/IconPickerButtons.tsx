import { ImagePlus, LayoutGrid, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Props {
  /** icône courante (data URL ou lien) : aperçu + bouton de retrait */
  favicon: string;
  /** favicon du site proposé en un clic (null = aucune suggestion) */
  suggest: string | null;
  /** ouvre le sélecteur de fichier local */
  onChooseFile: () => void;
  /** ouvre la bibliothèque d'icônes (Simple Icons) */
  onOpenLibrary: () => void;
  /** retire l'icône personnalisée */
  onRemove: () => void;
  /** applique le favicon suggéré */
  onSuggest: (dataUrl: string) => void;
}

/** Icône : aperçu + choix manuel + favicon du site en un clic. */
export function IconPickerButtons({
  favicon,
  suggest,
  onChooseFile,
  onOpenLibrary,
  onRemove,
  onSuggest,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
        {favicon ? (
          <img src={favicon} alt="" className="size-full object-contain" />
        ) : (
          <ImagePlus className="size-4 text-muted-foreground" />
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onChooseFile}>
        <ImagePlus />
        {t("Icône…")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenLibrary}
        title={t(
          "Choisir parmi des milliers d'icônes : logos d'apps et icônes génériques",
        )}
      >
        <LayoutGrid />
        {t("Bibliothèque…")}
      </Button>
      {favicon && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          title={t("Retirer l'icône personnalisée")}
        >
          <RotateCcw />
          {t("Réinitialiser")}
        </Button>
      )}
      {suggest && (
        <button
          type="button"
          onClick={() => onSuggest(suggest)}
          title={t("Utiliser le favicon du site (clic = appliquer)")}
          className="flex size-10 cursor-pointer items-center justify-center rounded-lg border border-dashed bg-muted/30 p-1.5 transition-colors outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <img src={suggest} alt="" className="size-full object-contain" />
        </button>
      )}
    </div>
  );
}
