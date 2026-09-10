import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUPS: { title: string; items: { keys: string[]; action: string }[] }[] =
  [
    {
      title: "Ajouter",
      items: [
        { keys: ["Ctrl", "N"], action: "Nouvelle ressource" },
        { keys: ["Ctrl", "Alt", "N"], action: "Nouvelle note" },
      ],
    },
    {
      title: "Retrouver",
      items: [
        { keys: ["Ctrl", "K"], action: "Palette de commandes" },
        {
          keys: ["Ctrl", "Alt", "Espace"],
          action: "Palette globale (configurable en Réglages)",
        },
        { keys: ["/"], action: "Aller à la recherche" },
        { keys: ["Ctrl", "F"], action: "Aller à la recherche" },
        { keys: ["Échap"], action: "Fermer / sortir du dossier" },
      ],
    },
    {
      title: "Organiser",
      items: [
        {
          keys: ["Ctrl", "Maj", "←", "→"],
          action: "Déplacer la tuile (tri manuel)",
        },
      ],
    },
  ];

/** Aide-mémoire des raccourcis clavier (bouton « ? » de l'en-tête). */
export function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="grid gap-1.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {g.title}
              </h3>
              {g.items.map((it) => (
                <div
                  key={it.action}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>{it.action}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {it.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-semibold"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Astuce : dépose une tuile au centre d'une autre pour créer un
            dossier, ou colle une URL n'importe où pour l'ajouter.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
