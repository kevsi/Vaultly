import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Remplace le pattern manuel répété ~25 fois dans l'app :
 *   busy flag → try/await api → toast succès → invalidate → toast erreur
 *
 * run() exécute l'action, affiche les toasts (message de succès par appel
 * via opts.success, erreur générique sinon) et invalide les clés passées.
 * busy est exposé pour désactiver les boutons pendant l'appel.
 */
export function useTauriMutation() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async <T>(
      action: () => Promise<T>,
      opts?: {
        /** Message de succès (retourner undefined pour rester silencieux). */
        success?: (result: T) => string | undefined;
        /** Clés à invalider après succès. */
        invalidate?: QueryKey[];
        /** Remplace le message d'erreur générique. */
        error?: (e: unknown) => string;
      },
    ): Promise<T | undefined> => {
      if (busy) return undefined;
      setBusy(true);
      try {
        const result = await action();
        const msg = opts?.success?.(result);
        if (msg) toast.success(msg);
        for (const key of opts?.invalidate ?? []) {
          void qc.invalidateQueries({ queryKey: key });
        }
        return result;
      } catch (e) {
        toast.error(opts?.error ? opts.error(e) : String(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [busy, qc],
  );

  return { run, busy };
}
