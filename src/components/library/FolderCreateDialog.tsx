import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createFolder, renameFolder } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Folder } from "@/lib/types";
import { describeError } from "@/lib/utils";

export type FolderDialogState =
  | { mode: "create" }
  | { mode: "rename"; folder: Folder }
  | null;

interface Props {
  state: FolderDialogState;
  name: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  /** dossier courant : une création y est imbriquée */
  parentFolderId: number | null;
  /** renommage : met à jour le fil d'Ariane si le dossier y figure */
  onBreadcrumbRename: (folderId: number, name: string) => void;
  onRefresh: () => void;
}

/** Création / renommage de dossier. */
export function FolderCreateDialog({
  state,
  name,
  onNameChange,
  onClose,
  parentFolderId,
  onBreadcrumbRename,
  onRefresh,
}: Props) {
  const { t } = useI18n();

  async function submit() {
    if (!state) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("Donne un nom au dossier"));
      return;
    }
    try {
      if (state.mode === "create") {
        // créé dans le dossier courant (imbrication)
        await createFolder(trimmed, undefined, parentFolderId);
        toast.success(t("Dossier « {name} » créé", { name: trimmed }));
      } else {
        await renameFolder(state.folder.id, trimmed);
        toast.success(t("Dossier renommé"));
        // met à jour le fil d'ariane si le dossier renommé y figure
        onBreadcrumbRename(state.folder.id, trimmed);
      }
      onClose();
      onRefresh();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "rename"
              ? t("Renommer le dossier")
              : t("Nouveau dossier")}
          </DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={t("Nom du dossier")}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button onClick={() => void submit()}>{t("Enregistrer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
