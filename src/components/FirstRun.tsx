import { useEffect, useRef, useState } from "react";
import { WelcomeSlides } from "@/components/WelcomeSlides";
import { runGuidedTour } from "@/lib/guidedTour";
import { useI18n } from "@/lib/i18n";
import { isOnboarded, markOnboarded, REPLAY_EVENT } from "@/lib/onboarding";

type Phase = "welcome" | "tour" | "done";

/**
 * Enchaîne le premier lancement : diaporama animé → visite guidée Driver.js.
 * Une seule fois (drapeau localStorage). Réglages peut relancer UNIQUEMENT la
 * visite via l'événement de rejeu.
 */
export function FirstRun() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>(() =>
    isOnboarded() ? "done" : "welcome",
  );
  const tourRef = useRef<ReturnType<typeof runGuidedTour> | null>(null);
  // t est une nouvelle closure à chaque render : on passe par un ref pour que
  // l'effet ne dépende que de `phase` — sinon chaque re-render de l'app
  // détruirait et relancerait le tour en pleine visite.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (phase !== "tour") return;
    const id = window.setTimeout(() => {
      tourRef.current = runGuidedTour(
        () => {
          tourRef.current = null;
          setPhase("done");
        },
        (key, params) => tRef.current(key, params),
      );
    }, 150);
    return () => {
      window.clearTimeout(id);
      tourRef.current?.destroy();
      tourRef.current = null;
    };
  }, [phase]);

  useEffect(() => {
    const onReplay = () => {
      markOnboarded();
      setPhase("tour");
    };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);

  if (phase === "welcome") {
    return (
      <WelcomeSlides
        onFinish={() => {
          markOnboarded();
          setPhase("tour");
        }}
      />
    );
  }
  return null;
}
