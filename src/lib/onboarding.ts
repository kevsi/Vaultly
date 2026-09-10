/**
 * Orchestration du « premier lancement » : diaporama animé (WelcomeSlides)
 * puis visite guidée (Driver.js). Les drapeaux sont en localStorage pour
 * n'apparaître qu'une fois. Un bouton « Revoir la visite » (Réglages) relance
 * uniquement le tour via un événement.
 */

const ONBOARDED_KEY = "vaultly-onboarded";

/** Événement émis par Réglages pour relancer la visite guidée. */
export const REPLAY_EVENT = "vaultly:replay-onboarding";

/** A-t-on déjà vu le diaporama de bienvenue ? */
export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true; // stockage indisponible : ne pas harceler
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Relance la visite guidée depuis un autre composant (Réglages). */
export function replayTour(): void {
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

/** Respecte la préférence système « réduire les animations ». */
export function prefersReducedMotion(): boolean {
  try {
    return (
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    );
  } catch {
    return false;
  }
}
