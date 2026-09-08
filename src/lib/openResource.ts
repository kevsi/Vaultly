import { openUrl } from "@tauri-apps/plugin-opener";
import { launchExecutable, openFilePath, recordOpen } from "./api";
import type { Resource } from "./types";

/**
 * Ouvre une ressource : incrémente le compteur, lance l'exécutable
 * pour une app Windows, sinon ouvre l'URL dans le navigateur.
 * Utilisé par la tuile ET la palette de commandes.
 */
export async function openResource(resource: Resource): Promise<void> {
  const exe = resource.meta?.exePath;
  const filePath = resource.meta?.filePath;
  if (exe) {
    // app Windows : lance toujours l'exécutable, même si un site web est renseigné
    await launchExecutable(exe);
  } else if (filePath) {
    // fichier local choisi via le sélecteur : l'url stockée est « local:<hex> »,
    // c'est meta.filePath qui porte le vrai chemin
    await openFilePath(filePath);
  } else if (resource.url.startsWith("file:")) {
    // fichier local : ouverture par l'application Windows par défaut
    await openFilePath(resource.url.slice(5));
  } else if (resource.url.startsWith("exe:")) {
    await launchExecutable(resource.url.slice(4));
  } else if (resource.url.startsWith("local:")) {
    return; // sans lien : rien à ouvrir, rien à compter
  } else {
    await openUrl(resource.url);
  }
  // compté seulement si l'ouverture a réussi ; un échec du compteur ne doit
  // pas faire croire à l'utilisateur que l'ouverture a échoué
  await recordOpen(resource.id).catch(() => {});
}
