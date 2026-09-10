import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { removeTag, renameTag, tagStats } from "@/lib/api";
import { cn, describeError } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/**
 * Gestionnaire de tags : renommer (vers un nom existant = fusionner) ou
 * supprimer un tag dans toute la bibliothèque. Ouvert depuis la barre
 * d'outils de la bibliothèque.
 */
export function TagManagerDialog({ open, onOpenChange, onChanged }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: tags, isLoading } = useQuery({
    queryKey: ["tagStats"],
    queryFn: tagStats,
    enabled: open,
  });

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tags ?? [];
    return (tags ?? []).filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, filter]);

  async function runRename() {
    if (!editing) return;
    const next = editValue.trim();
    if (!next) {
      toast.error("Le nouveau nom ne peut pas être vide");
      return;
    }
    setBusy(true);
    try {
      const n = await renameTag(editing, next);
      toast.success(
        n === 0
          ? "Rien à renommer"
          : `« ${editing} » → « ${next} » (${n} ressource${n > 1 ? "s" : ""})`,
      );
      setEditing(null);
      setEditValue("");
      void qc.invalidateQueries({ queryKey: ["tagStats"] });
      onChanged();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(tag: string) {
    setBusy(true);
    try {
      const n = await removeTag(tag);
      toast.success(
        `Tag « ${tag} » supprimé (${n} ressource${n > 1 ? "s" : ""})`,
      );
      setDeleteArmed(null);
      void qc.invalidateQueries({ queryKey: ["tagStats"] });
      onChanged();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gérer les tags</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Renommer vers un tag existant les fusionne. La suppression retire le
            tag partout, sans toucher aux ressources.
          </p>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrer les tags…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Chargement…
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {(tags ?? []).length === 0
                  ? "Aucun tag pour l'instant."
                  : `Aucun tag pour « ${filter.trim()} ».`}
              </p>
            ) : (
              visible.map((t) => (
                <div
                  key={t.name}
                  className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  {editing === t.name ? (
                    <>
                      <Input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void runRename();
                          if (e.key === "Escape") setEditing(null);
                        }}
                        list="tagmanager-existing"
                        className="h-7"
                        disabled={busy}
                      />
                      <datalist id="tagmanager-existing">
                        {(tags ?? [])
                          .filter((x) => x.name !== t.name)
                          .map((x) => (
                            <option key={x.name} value={x.name} />
                          ))}
                      </datalist>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void runRename()}
                        disabled={busy}
                        title="Appliquer le nouveau nom"
                      >
                        <Check />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                        title="Annuler"
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {t.name}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                        {t.count}
                      </span>
                      {deleteArmed === t.name ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void runDelete(t.name)}
                            disabled={busy}
                            className="h-7"
                          >
                            {busy ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                            Supprimer ?
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteArmed(null)}
                            disabled={busy}
                            title="Annuler"
                          >
                            <X />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setEditing(t.name);
                              setEditValue(t.name);
                              setDeleteArmed(null);
                            }}
                            disabled={busy}
                            title={`Renommer « ${t.name} »`}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setDeleteArmed(t.name);
                              setEditing(null);
                            }}
                            disabled={busy}
                            title={`Supprimer « ${t.name} » partout`}
                            className={cn(
                              "text-muted-foreground hover:text-destructive",
                            )}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {(tags ?? []).length} tag{(tags ?? []).length > 1 ? "s" : ""} au
            total.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
