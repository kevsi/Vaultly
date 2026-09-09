import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect } from "react";
import { isUrlKnown } from "@/lib/api";

/**
 * Surveille le presse-papiers toutes les 2 s : si une nouvelle URL web
 * apparaît (non déjà enregistrée), émet un événement pour proposer
 * son ajout via la modale.
 *
 * NOTE : l'état est au niveau module (pas dans un useRef) car en dev
 * React.StrictMode monte l'effet deux fois → deux boucles concurrentes
 * qui doivent partager le même état, sinon l'une ignore ce que l'autre
 * a déjà traité.
 */
let lastSeenUrl = "";

/**
 * URL à ignorer pendant quelques secondes : l'app elle-même copie parfois
 * des liens (partage Drive, backup…) dans le presse-papiers — sans ça,
 * le surveillant croirait que l'utilisateur veut les ajouter et ouvrirait
 * le formulaire tout seul. Fenêtre temporelle (et non usage unique) pour
 * que toutes les boucles concurrentes l'ignorent.
 */
let suppressedUrl = "";
let suppressedUntil = 0;

export function suppressClipboardCapture(url: string, ms = 10000) {
  suppressedUrl = url.trim();
  suppressedUntil = Date.now() + ms;
}

export function useClipboardCapture() {
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    async function check() {
      if (!alive) return;
      // fenêtre masquée (close-to-tray) : ne pas lire le presse-papiers
      // système — une URL sensible copiée ailleurs (lien de reset, lien de
      // partage avec token) ne doit pas être détectée pendant que l'app
      // tourne en fond, ni faire surgir la modale à la réouverture.
      if (document.visibilityState !== "visible") {
        timer = window.setTimeout(check, 2000);
        return;
      }
      try {
        const raw = await readText();
        const url = raw?.trim() ?? "";
        if (
          url &&
          url !== lastSeenUrl &&
          (url.startsWith("http://") || url.startsWith("https://"))
        ) {
          // marquer vu tout de suite : les boucles jumelles l'ignoreront
          lastSeenUrl = url;
          const suppressed =
            suppressedUrl !== "" &&
            url === suppressedUrl &&
            Date.now() < suppressedUntil;
          if (!suppressed) {
            const known = await isUrlKnown(url);
            if (alive && !known) {
              window.dispatchEvent(
                new CustomEvent("vaultly:add-url", { detail: url }),
              );
            }
          }
        }
      } catch {
        // presse-papiers vide ou non lisible : silencieux
      }
      if (alive) timer = window.setTimeout(check, 2000);
    }
    void check();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}
