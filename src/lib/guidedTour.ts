import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "@/styles/driver-theme.css";
import { prefersReducedMotion } from "./onboarding";

/**
 * Visite guidée de premier lancement (Driver.js). Chaque étape cible un
 * élément porteur d'un attribut `data-tour="…"` ajouté en dur dans l'UI
 * (sélecteurs stables, insensibles aux classes utilitaires Tailwind).
 * Retourne l'instance pour permettre un `destroy()` au démontage.
 */
export function runGuidedTour(onDestroyed: () => void) {
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
    nextBtnText: "Suivant",
    prevBtnText: "Précédent",
    doneBtnText: "Terminer",
    // ne bloque pas le clic sur les cibles : l'utilisateur peut essayer
    skipMissingElement: true,
    waitForElement: 1500,
    onDestroyed: () => onDestroyed(),
    steps: [
      {
        element: '[data-tour="nav"]',
        popover: {
          title: "Navigue partout",
          description:
            "Bibliothèque, Importer, Stats, Corbeille et Réglages sont juste ici, sous la barre de titre.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="add"]',
        popover: {
          title: "Ajoute en un clic",
          description:
            "Colle une URL : Vaultly devine le type et remplit titre, description, icône et tags tout seul.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="search"]',
        popover: {
          title: "Retrouve instantanément",
          description:
            "Recherche plein texte (raccourci « / »). Et Ctrl+K — ou Ctrl+Alt+Espace n'importe où dans Windows — ouvre la palette.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="view"]',
        popover: {
          title: "Tuiles, liste ou tableau",
          description:
            "Bascule l'affichage : grille de tuiles, liste dense, ou tableau façon kanban trié par statut.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="filters"]',
        popover: {
          title: "Filtre comme tu veux",
          description:
            "Par type, tag ou statut. Le sablier « À revisiter » fait ressortir ce que tu n'as plus ouvert depuis longtemps.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="shortcuts"]',
        popover: {
          title: "Aide & fenêtre",
          description:
            "Le bouton « ? » liste tous les raccourcis. Fermer la fenêtre la masque dans la barre des tâches : la palette la fait resurgir.",
          side: "bottom",
        },
      },
      {
        element: '[data-tour="settings"]',
        popover: {
          title: "À toi de jouer",
          description:
            "Réglages : thème (Anime, Pro, Néon…), fond, sauvegarde cloud WebDAV, navigateur d'ouverture… et « Revoir la visite guidée ».",
          side: "bottom",
        },
      },
    ],
  });
  d.drive();
  return d;
}
