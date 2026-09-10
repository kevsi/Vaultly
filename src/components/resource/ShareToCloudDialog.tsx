import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cloudAppendLink, cloudListShareLists } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Resource, ShareListInfo } from "@/lib/types";
import { describeError } from "@/lib/utils";

interface Props {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Dialogue : choisir ou créer le fichier JSON de partage (WebDAV).
 *  Les listes existantes sont chargées à chaque ouverture. */
export function ShareToCloudDialog({ resource, open, onOpenChange }: Props) {
  const { t } = useI18n();
  const [shareLists, setShareLists] = useState<ShareListInfo[] | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  /** name d'une liste existante, ou "__new" pour créer un fichier */
  const [shareTarget, setShareTarget] = useState<string>("__new");
  const [newFileName, setNewFileName] = useState("");
  const [sharing, setSharing] = useState(false);

  // ouverture : liste les fichiers JSON du dossier WebDAV (l'ancien
  // openShareDialog, déclenché ici au passage à open = true)
  useEffect(() => {
    if (!open) return;
    void (async () => {
      setShareLoading(true);
      try {
        const lists = await cloudListShareLists();
        setShareLists(lists);
        setShareTarget(lists.length > 0 ? lists[0].name : "__new");
      } catch (e) {
        toast.error(describeError(e));
        setShareLists([]);
      } finally {
        setShareLoading(false);
      }
    })();
  }, [open]);

  async function runShareToCloud() {
    const isNew = shareTarget === "__new";
    const name = newFileName.trim();
    if (isNew && !name) {
      toast.error(t("Donne un nom à la liste (ex. Design)"));
      return;
    }
    setSharing(true);
    try {
      const res = await cloudAppendLink({
        name: isNew ? null : shareTarget,
        newListTitle: isNew ? name : null,
        title: resource.title || resource.url,
        url: resource.url,
        addedAt: new Date().toISOString(),
      });
      const label = res.name;
      if (res.added) {
        toast.success(
          t("Lien ajouté à « {name} » ({count} lien(s))", {
            name: label,
            count: res.total,
          }),
        );
      } else {
        toast.info(t("Ce lien est déjà dans « {name} »", { name: label }));
      }
      onOpenChange(false);
      setNewFileName("");
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Partager vers le cloud")}</DialogTitle>
          <DialogDescription>
            {t(
              "Le lien sera enregistré dans un fichier JSON de ton dossier WebDAV. Choisis une liste existante ou crées-en une nouvelle (ex. Design, AIAPI).",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t("Liste de destination")}</Label>
            <Select
              value={shareTarget}
              onValueChange={(v) => setShareTarget(v ?? "__new")}
              disabled={shareLoading || sharing}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Choisir…")} />
              </SelectTrigger>
              <SelectContent>
                {(shareLists ?? []).map((l) => (
                  <SelectItem key={l.name} value={l.name}>
                    {t("{title} ({count} lien(s))", {
                      title: l.title,
                      count: l.count,
                    })}
                  </SelectItem>
                ))}
                <SelectItem value="__new">{t("+ Nouvelle liste…")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {shareTarget === "__new" && (
            <div className="grid gap-1.5">
              <Label>{t("Nom de la nouvelle liste")}</Label>
              <Input
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="Design"
                disabled={sharing}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sharing}
          >
            {t("Annuler")}
          </Button>
          <Button onClick={() => void runShareToCloud()} disabled={sharing}>
            {sharing && <Loader2 className="animate-spin" />}
            {t("Partager")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
