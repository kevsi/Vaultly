import { Lottie } from "lottie-react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import welcome1 from "@/assets/lottie/welcome-1.json";
import welcome2 from "@/assets/lottie/welcome-2.json";
import welcome3 from "@/assets/lottie/welcome-3.json";
import { Button } from "@/components/ui/button";
import { prefersReducedMotion } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    data: welcome1,
    title: "Bienvenue dans Vaultly",
    text: "Ton hub personnel : tous tes bons sites, apps, fichiers et notes, réunis en tuiles.",
  },
  {
    data: welcome2,
    title: "Range sans effort",
    text: "Dossiers imbriqués, tags, favoris, tableau par statut. Les doublons sont fusionnés tout seul.",
  },
  {
    data: welcome3,
    title: "Retrouve et connecte ton IA",
    text: "Recherche instantanée, palette n'importe où, et tes assistants IA qui lisent ta bibliothèque.",
  },
] as const;

/** Diaporama animé du tout premier lancement, puis relais vers la visite. */
export function WelcomeSlides({ onFinish }: { onFinish: () => void }) {
  const [i, setI] = useState(0);
  const reduce = prefersReducedMotion();
  const last = i === SLIDES.length - 1;

  // Échap = passer (on ne bloque jamais un premier lancement)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish]);

  const slide = SLIDES[i];
  return (
    <div className="fixed inset-0 z-[120] flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bienvenue dans Vaultly"
        className="w-full max-w-sm animate-pop-in rounded-3xl border bg-card p-7 text-center shadow-2xl"
      >
        <div className="mx-auto size-40">
          <Lottie
            key={i}
            src={slide.data}
            loop={!reduce}
            autoplay={!reduce}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
        <h2 className="mt-2 text-xl font-semibold">{slide.title}</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {slide.text}
        </p>

        <div className="mt-6 flex items-center justify-center gap-1.5">
          {SLIDES.map((s, d) => (
            <span
              key={s.title}
              className={cn(
                "h-1.5 rounded-full transition-all",
                d === i ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/40",
              )}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onFinish}>
            Passer
          </Button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setI((v) => v - 1)}
                aria-label="Précédent"
              >
                <ArrowLeft />
              </Button>
            )}
            {last ? (
              <Button
                onClick={onFinish}
                title="Démarrer la visite guidée de l'interface"
              >
                <Sparkles />
                Découvrir
              </Button>
            ) : (
              <Button onClick={() => setI((v) => v + 1)} title="Étape suivante">
                Suivant
                <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
