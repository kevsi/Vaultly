import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => void | Promise<void>;
}

/**
 * Modale de confirmation stylée, en remplacement de window.confirm.
 * Conduit par un état ConfirmState | null dans le parent.
 */
export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {state?.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant={state?.destructive ? "destructive" : "default"}
            onClick={() => {
              void state?.action();
              onClose();
            }}
          >
            {state?.confirmLabel ?? "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
