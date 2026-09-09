import { createFolder, listFolders } from "@/lib/api";
import type { Folder } from "@/lib/types";

/**
 * Création sérialisée des dossiers système (« À traiter », « Archivés ») :
 * le check listFolders → createFolder n'est pas atomique, deux appels en
 * rafale créaient deux dossiers homonymes. Le verrou module-scope garantit
 * qu'un seul createFolder est en vol à la fois ; le second relit la liste
 * après le premier et trouve le dossier déjà créé.
 */
let creating: Promise<Folder> | null = null;

export async function ensureSystemFolder(name: string): Promise<Folder> {
  if (creating) {
    await creating.catch(() => {});
  }
  creating = (async () => {
    const existing = (await listFolders()).find(
      (f) => f.name === name && f.parentId === null,
    );
    if (existing) return existing;
    return createFolder(name);
  })();
  try {
    return await creating;
  } finally {
    creating = null;
  }
}
