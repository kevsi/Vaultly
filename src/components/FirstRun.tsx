import { useEffect, useRef, useState } from "react";
import { WelcomeSlides } from "@/components/WelcomeSlides";
import { runGuidedTour } from "@/lib/guidedTour";
import { isOnboarded, markOnboarded, REPLAY_EVENT } from "@/lib/onboarding";

type Phase = "welcome" | "tour" | "done";

/**
 * Enchaîne le premier lancement : diaporama animé → visite guidée Driver.js.
 * Une seule fois (drapeau localStorage). Réglages peut relancer UNIQUEMENT la
 * visite via l'événement de rejeu.
 */
export function FirstRun() {
  const [phase, setPhase] = useState<Phase>(() =>
    isOnboarded() ? "done" : "welcome",
  );
  const tourRef = useRef<ReturnType<typeof runGuidedTour> | null>(null);

  useEffect(() => {
    if (phase !== "tour") return;
    // léger différé : laisse la toolbar bibliothèque se stabiliser/afficher
    const id = window.setTimeout(() => {
      tourRef.current = runGuidedTour(() => {
        tourRef.current = null;
        setPhase("done");
      });
    }, 150);
    return () => {
      window.clearTimeout(id);
      // ne détruit que si le tour est encore vivant (sinon déjà fermé)
      tourRef.current?.destroy();
      tourRef.current = null;
    };
  }, [phase]);

  // Rejeu demandé depuis Réglages : relancer directement la visite.
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
