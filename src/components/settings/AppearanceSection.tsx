import { Check, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  BG_GRADIENTS,
  type BgState,
  BUTTON_STYLES,
  FONT_SCALES,
  FONTS,
  type FontId,
  imageFileToDataUrl,
  STYLES,
  updateAppearance,
  useAppearance,
} from "@/lib/appearance";
import { useI18n } from "@/lib/i18n";
import { cn, describeError } from "@/lib/utils";

export function AppearanceSection() {
  // apparence (style, typographie, boutons, arrière-plan) — réactive
  const appearance = useAppearance();
  const { t, lang, setLang: setUiLang } = useI18n();
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const [bgBusy, setBgBusy] = useState(false);

  async function pickBackgroundImage(file: File | undefined) {
    if (!file) return;
    setBgBusy(true);
    try {
      const image = await imageFileToDataUrl(file);
      updateAppearance({ bg: { kind: "image", image } satisfies BgState });
      toast.success(t("settings.bg-applied"));
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBgBusy(false);
    }
  }

  return (
    <>
      {/* style d'ambiance */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.ambiance")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "La palette de couleurs de toute l'interface — appliquée aussitôt, en mode clair comme en mode sombre.",
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STYLES.map((s) => {
            const active = appearance.style === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => updateAppearance({ style: s.id })}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-primary ring-2 ring-primary/30"
                    : "cursor-pointer border-border hover:bg-accent/50",
                )}
              >
                <span className="flex items-center gap-1.5" aria-hidden="true">
                  <span
                    className="size-4 rounded-full border border-black/10"
                    style={{ background: s.swatch.bg }}
                  />
                  <span
                    className="size-4 rounded-full"
                    style={{ background: s.swatch.primary }}
                  />
                  <span
                    className="size-4 rounded-full"
                    style={{ background: s.swatch.accent }}
                  />
                  {active && <Check className="ml-auto size-4 text-primary" />}
                </span>
                <span className="mt-2 block text-sm font-medium">
                  {t(s.label)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(s.desc)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* langue de l'interface */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("Langue")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Langue de l'interface. Appliqué immédiatement (les sous-titres avancés restent en français pour l'instant).",
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {(["fr", "en"] as const).map((l) => (
            <Button
              key={l}
              variant={lang === l ? "default" : "outline"}
              size="sm"
              onClick={() => setUiLang(l)}
              aria-pressed={lang === l}
            >
              {l === "fr" ? "Français" : "English"}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* typographie */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.typography")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "La police utilisée partout dans l'interface, titres comme texte.",
            )}
          </p>
        </div>
        <Select
          value={appearance.font}
          onValueChange={(v) => updateAppearance({ font: v as FontId })}
        >
          <SelectTrigger className="w-full max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONTS.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span style={{ fontFamily: f.stack }}>{t(f.label)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          className="text-sm text-muted-foreground"
          style={{
            fontFamily: FONTS.find((f) => f.id === appearance.font)?.stack,
          }}
        >
          {t("Aperçu : classez et retrouvez tout ce que vous aimez.")}{" "}
          1234567890
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-sm text-muted-foreground">{t("Taille :")}</span>
          {FONT_SCALES.map((s) => (
            <Button
              key={s.id}
              variant={appearance.fontScale === s.id ? "default" : "outline"}
              size="sm"
              onClick={() => updateAppearance({ fontScale: s.id })}
            >
              {t(s.label)}
            </Button>
          ))}
        </div>
      </div>

      <Separator />

      {/* style des boutons */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.button-style")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "La forme et l'effet des boutons de toute l'app — l'aperçu ci-dessous suit ton choix en direct.",
            )}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUTTON_STYLES.map((b) => {
            const active = appearance.buttons === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => updateAppearance({ buttons: b.id })}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-primary ring-2 ring-primary/30"
                    : "cursor-pointer border-border hover:bg-accent/50",
                )}
              >
                <span className="flex items-center justify-between text-sm font-medium">
                  {t(b.label)}
                  {active && <Check className="size-4 text-primary" />}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(b.desc)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/40 p-3">
          <span className="text-xs text-muted-foreground">{t("Aperçu :")}</span>
          <Button size="sm">{t("Action")}</Button>
          <Button size="sm" variant="secondary">
            {t("Secondaire")}
          </Button>
          <Button size="sm" variant="outline">
            {t("Contour")}
          </Button>
        </div>
      </div>

      <Separator />

      {/* arrière-plan */}
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">{t("settings.background")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Un fond derrière l'interface : dégradé prêt à l'emploi ou ta propre image.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => updateAppearance({ bg: { kind: "default" } })}
            aria-pressed={appearance.bg.kind === "default"}
            title={t("settings.solid-bg")}
            className={cn(
              "h-14 w-24 cursor-pointer rounded-xl border bg-muted text-xs font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              appearance.bg.kind === "default" &&
                "border-primary text-foreground ring-2 ring-primary/30",
            )}
          >
            {t("Défaut")}
          </button>
          {BG_GRADIENTS.map((g) => {
            const active =
              appearance.bg.kind === "gradient" && appearance.bg.id === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  updateAppearance({
                    bg: { kind: "gradient", id: g.id },
                  })
                }
                aria-pressed={active}
                title={t(g.label)}
                style={{ backgroundImage: g.css }}
                className={cn(
                  "h-14 w-24 cursor-pointer rounded-xl border border-border bg-background text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active && "border-primary ring-2 ring-primary/30",
                )}
              >
                <span className="rounded bg-background/70 px-1.5 py-0.5">
                  {t(g.label)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => bgFileRef.current?.click()}
            disabled={bgBusy}
            aria-pressed={appearance.bg.kind === "image"}
            title={t("Choisir une image sur ton PC")}
            className={cn(
              "flex h-14 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-accent/50 disabled:opacity-60",
              appearance.bg.kind === "image" &&
                "border-primary text-foreground ring-2 ring-primary/30",
            )}
          >
            {bgBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlus className="size-4" />
            )}
            {t("settings.my-image")}
          </button>
        </div>
        {appearance.bg.kind === "image" && (
          <div className="flex items-center gap-3">
            <img
              src={appearance.bg.image}
              alt={t("Arrière-plan personnalisé")}
              className="h-14 w-24 rounded-lg border object-cover"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateAppearance({ bg: { kind: "default" } })}
            >
              <Trash2 />
              {t("Retirer")}
            </Button>
          </div>
        )}
        {appearance.bg.kind !== "default" && (
          <label className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {t("settings.darken")}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(appearance.bgDim * 100)}
              onChange={(e) =>
                updateAppearance({
                  bgDim: Number(e.target.value) / 100,
                })
              }
              className="w-40 accent-primary"
            />
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
              {Math.round(appearance.bgDim * 100)} %
            </span>
          </label>
        )}
        {/* sélecteur de fichier image (dialog natif du WebView) */}
        <input
          ref={bgFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pickBackgroundImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </>
  );
}
