import { openResourceById } from "./api";
import type { Resource } from "./types";

/**
 * Ouvre une ressource : incrémente le compteur, lance l'exécutable
 * pour une app Windows, sinon ouvre l'URL dans le navigateur.
 * Utilisé par la tuile ET la palette de commandes.
 *
 * Toute l'ouverture passe par la commande Rust `open_resource` : la webview
 * ne transmet qu'un id, jamais un chemin ni une URL (les anciennes commandes
 * launch_executable/open_file_path acceptaient un chemin arbitraire — pivot
 * OS pour une webview compromise). `record_open` est décompté côté Rust
 * uniquement si l'ouverture a réussi.
 */
export async function openResource(resource: Resource): Promise<void> {
  // ressource sans lien (local:<hex>) : rien à ouvrir, rien à compter
  if (
    !resource.meta?.exePath &&
    !resource.meta?.filePath &&
    resource.url.startsWith("local:")
  ) {
    return;
  }
  await openResourceById(resource.id);
}
