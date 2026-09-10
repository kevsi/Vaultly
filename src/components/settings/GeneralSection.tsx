import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, GraduationCap, Power } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  getAutostart,
  openLogsFolder,
  setAutostart,
  setGlobalShortcut,
} from "@/lib/api";
import {
  getPageDensity,
  PAGE_DENSITIES,
  type PageDensity,
  setPageDensity as persistPageDensity,
} from "@/lib/gridPagination";
import { useI18n } from "@/lib/i18n";
import { replayTour } from "@/lib/onboarding";
import {
  getTileSize,
  setTileSize as persistTileSize,
  TILE_SIZES,
  type TileSize,
} from "@/lib/tileSize";
import { describeError } from "@/lib/utils";

export function GeneralSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  // densité de pagination (Réglages → Général → Rendu de la grille)
  const [pageDensity, setPageDensityState] =
    useState<PageDensity>(getPageDensity);
  // taille des tuiles (réglage visuel)
  const [tileSize, setTileSizeState] = useState<TileSize>(getTileSize);

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
        enabled ? t("settings.autostart-on") : t("settings.autostart-off"),
      );
      void qc.invalidateQueries({ queryKey: ["autostart"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <>
      {/* raccourci global de la palette */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("Raccourci global de la palette")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.shortcut-desc")}
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
                  .then(() =>
                    toast.success(
                      t("Raccourci : {shortcut}", { shortcut: sc }),
                    ),
                  )
                  .catch((e) => toast.error(describeError(e)))
              }
            >
              {sc.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* rendu de la grille : rangées par page (pagination) */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.grid-render")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "La bibliothèque est paginée (plus de défilement) : on choisit ici combien de rangées de tuiles tiennent sur une page. Les colonnes s'adaptent automatiquement à la largeur de la fenêtre.",
            )}
          </p>
        </div>
        <Select
          value={pageDensity}
          onValueChange={(v) => {
            const next = v as PageDensity;
            setPageDensityState(next);
            persistPageDensity(next);
          }}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_DENSITIES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {t(m.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(
            PAGE_DENSITIES.find((m) => m.value === pageDensity)?.description ??
              "",
          )}
        </p>
      </div>

      <Separator />

      {/* taille des tuiles (réglage visuel) */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.tile-size")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Change la densité de la bibliothèque : plus les tuiles sont petites, plus tu en vois à l'écran. La grille reste fluide (les tuiles s'élargissent pour remplir la fenêtre).",
            )}
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
                {t(s.label)} ({s.minPx} px)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* lancement au démarrage + présence système */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.autostart")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Vaultly reste actif dans la barre des tâches : la croix de la fenêtre masque l'app (le raccourci global la fait resurgir), et « Quitter » dans le menu de l'icône sauvegarde puis ferme.",
            )}
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
            {t("settings.auto-open-windows")}
          </Label>
        </div>
      </div>

      <Separator />

      {/* journal de logs (support) */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.log")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "En cas de bug, ouvre le dossier des logs et joins le fichier du jour à ton rapport.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() =>
            void openLogsFolder().catch((e) => toast.error(describeError(e)))
          }
        >
          <FileText />
          {t("Ouvrir le dossier des logs")}
        </Button>
      </div>

      <Separator />

      {/* relancer la visite guidée du premier lancement */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.guided-tour")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Revoir la présentation animée et le tour des fonctions clés de l'interface.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => replayTour()}
        >
          <GraduationCap />
          {t("Revoir la visite guidée")}
        </Button>
      </div>
    </>
  );
}
