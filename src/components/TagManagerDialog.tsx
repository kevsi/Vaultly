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
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
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
      toast.error(t("Le nouveau nom ne peut pas être vide"));
      return;
    }
    setBusy(true);
    try {
      const n = await renameTag(editing, next);
      toast.success(
        n === 0
          ? t("Rien à renommer")
          : t("« {from} » → « {to} » ({count} ressource(s))", {
              from: editing,
              to: next,
              count: n,
            }),
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
        t("Tag « {tag} » supprimé ({count} ressource(s))", {
          tag,
          count: n,
        }),
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
          <DialogTitle>{t("Gérer les tags")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t(
              "Renommer vers un tag existant les fusionne. La suppression retire le tag partout, sans toucher aux ressources.",
            )}
          </p>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("Filtrer les tags…")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("Chargement…")}
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {(tags ?? []).length === 0
                  ? t("Aucun tag pour l'instant.")
                  : t("Aucun tag pour « {filter} ».", {
                      filter: filter.trim(),
                    })}
              </p>
            ) : (
              visible.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  {editing === tag.name ? (
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
                          .filter((x) => x.name !== tag.name)
                          .map((x) => (
                            <option key={x.name} value={x.name} />
                          ))}
                      </datalist>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void runRename()}
                        disabled={busy}
                        title={t("Appliquer le nouveau nom")}
                      >
                        <Check />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                        title={t("Annuler")}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {tag.name}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                        {tag.count}
                      </span>
                      {deleteArmed === tag.name ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void runDelete(tag.name)}
                            disabled={busy}
                            className="h-7"
                          >
                            {busy ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                            {t("Supprimer ?")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteArmed(null)}
                            disabled={busy}
                            title={t("Annuler")}
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
                              setEditing(tag.name);
                              setEditValue(tag.name);
                              setDeleteArmed(null);
                            }}
                            disabled={busy}
                            title={t("Renommer « {name} »", { name: tag.name })}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setDeleteArmed(tag.name);
                              setEditing(null);
                            }}
                            disabled={busy}
                            title={t("Supprimer « {name} » partout", {
                              name: tag.name,
                            })}
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
            {t("{count} tag(s) au total.", { count: (tags ?? []).length })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
