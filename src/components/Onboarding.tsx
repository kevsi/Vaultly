import { useEffect, useState } from "react";
import { Command } from "lucide-react";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  { emoji: "🎨", name: "Canva", kind: "Site" },
  { emoji: "🐙", name: "GitHub", kind: "Dépôt" },
  { emoji: "▶️", name: "YouTube", kind: "Vidéo" },
];

/**
 * Carte de bienvenue au tout premier lancement : montre l'esprit
 * (tuiles + palette) et le raccourci Ctrl+Alt+Espace. Ne réapparaît plus
 * une fois fermée (persisté en localStorage).
 */
export function Onboarding({ onTryPalette }: { onTryPalette: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("vaultly-onboarded")) setOpen(true);
  }, []);

  function dismiss() {
    localStorage.setItem("vaultly-onboarded", "1");
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex animate-fade-in items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bienvenue dans Vaultly"
        className="w-full max-w-md animate-pop-in rounded-2xl border bg-card p-6 shadow-2xl"
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png?v=2" alt="" className="size-9 rounded-xl object-cover" />
          <h2 className="text-lg font-semibold">Bienvenue dans Vaultly</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Ton hub de ressources : tous tes bons sites, apps et outils au même
          endroit, accessibles à ton assistant IA.
        </p>

        {/* aperçu du style tuiles */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {EXAMPLES.map((e, i) => (
            <div
              key={e.name}
              className="flex animate-tile-in flex-col items-center gap-1.5 rounded-xl border bg-background p-3"
              style={{ animationDelay: `${150 + i * 90}ms` }}
            >
              <span className="text-3xl">{e.emoji}</span>
              <span className="text-xs font-medium">{e.name}</span>
              <span className="text-[10px] text-muted-foreground">{e.kind}</span>
            </div>
          ))}
        </div>

        {/* le réflexe raccourci */}
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-muted/50 p-3">
          <Command className="size-5 shrink-0 text-primary" />
          <p className="text-sm">
            Le réflexe à prendre : appuie sur{" "}
            <kbd className="rounded bg-background px-1.5 py-0.5 text-xs font-semibold shadow-sm">
              Ctrl
            </kbd>{" "}
            +{" "}
            <kbd className="rounded bg-background px-1.5 py-0.5 text-xs font-semibold shadow-sm">
              Alt
            </kbd>{" "}
            +{" "}
            <kbd className="rounded bg-background px-1.5 py-0.5 text-xs font-semibold shadow-sm">
              Espace
            </kbd>{" "}
            n'importe où dans Windows pour ouvrir la palette.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Plus tard
          </Button>
          <Button
            onClick={() => {
              dismiss();
              onTryPalette();
            }}
          >
            <Command />
            Essayer la palette
          </Button>
        </div>
      </div>
    </div>
  );
}
