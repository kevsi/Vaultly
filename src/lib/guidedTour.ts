import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "@/styles/driver-theme.css";
import { prefersReducedMotion } from "./onboarding";

/**
 * Guided tour for first launch (Driver.js). Each step targets an element
 * with a `data-tour="…"` attribute hard-coded in the UI (stable selectors).
 * Returns the instance so callers can `destroy()` on unmount.
 */
export function runGuidedTour(
  onDestroyed: () => void,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const d = driver({
    animate: !prefersReducedMotion(),
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    allowClose: true,
    overlayColor: "#000000",
    overlayOpacity: 0.6,
    stagePadding: 8,
    stageRadius: 12,
    popoverClass: "vaultly-tour",
    nextBtnText: t("common.next"),
    prevBtnText: t("common.prev"),
    doneBtnText: t("common.finish"),
    skipMissingElement: true,
    waitForElement: 1500,
    onDestroyed: () => onDestroyed(),
    steps: [
      {
        element: '[data-tour="nav"]',
        popover: {
          title: t("tour.nav.title"),
          description: t("tour.nav.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="add"]',
        popover: {
          title: t("tour.add.title"),
          description: t("tour.add.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="search"]',
        popover: {
          title: t("tour.search.title"),
          description: t("tour.search.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="view"]',
        popover: {
          title: t("tour.view.title"),
          description: t("tour.view.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="filters"]',
        popover: {
          title: t("tour.filters.title"),
          description: t("tour.filters.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="shortcuts"]',
        popover: {
          title: t("tour.shortcuts.title"),
          description: t("tour.shortcuts.desc"),
          side: "bottom",
        },
      },
      {
        element: '[data-tour="settings"]',
        popover: {
          title: t("tour.settings.title"),
          description: t("tour.settings.desc"),
          side: "bottom",
        },
      },
    ],
  });
  d.drive();
  return d;
}
