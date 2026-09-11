import { useEffect, useRef, useState } from "react";
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
import { useI18n } from "@/lib/i18n";

/**
 * Modale de saisie texte, en remplacement de window.prompt (peu fiable
 * dans un WebView). `onDone` reçoit null si annulé, sinon la valeur saisie.
 */
export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  initialValue = "",
  confirmLabel,
  onDone,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onDone: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // réinitialise la valeur à chaque ouverture et focus l'input
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      // le temps que la modale monte son contenu
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onDone(value.trim() || null);
          }}
        >
          <Input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onDone(null);
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onDone(null)}
            >
              {t("Annuler")}
            </Button>
            <Button type="submit">{confirmLabel ?? t("Valider")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
