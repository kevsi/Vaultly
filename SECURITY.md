# Sécurité — Vaultly

Modèle de menace, frontières de confiance et mesures en place. Doc interne ;
à garder à jour à chaque fonctionnalité touchant une frontière.

## Nature de l'application

Vaultly est un **hub personnel desktop (Tauri 2 / Windows), 100 % local**. Il
n'existe pas de serveur Vaultly distant ni de compte cloud obligatoire. Les
seules données sont sur la machine de l'utilisateur (`%APPDATA%\com.kevsi.vaultly`,
SQLite + DPAPI). Par « attaquant » on entend surtout : un **site web / contenu
distant de confiance zero** (README GitHub, page ajoutée via extension, favoris
importés, image/personnalisation) et un **client réseau local** non autorisé.

## Frontières de confiance

1. **Webview ↔ OS (IPC Tauri).** La webview n'appelle **jamais** une primitive
   OS directement avec un chemin/URL libre : toute ouverture passe par la
   commande Rust `open_resource(id)` qui **relit l'objet en base** (la webview
   ne fournit qu'un id). Les anciennes `launch_executable`/`open_file_path`
   (chemin arbitre depuis le JS) ont été retirées pour ce motif.
2. **Serveur HTTP local (MCP + `/api/add`).** Bind **`127.0.0.1` uniquement**.
   Chaque requête exige `Host` local (**anti DNS-rebinding**) et, si `Origin`
   présent, une origine exacte de la liste (`localhost`/`127.0.0.1`/`tauri`/
   `chrome-extension://`). Comparaison des **tokens en temps constant**.
   Deux jetons : **MCP** (accès complet) et **add-only** (uniquement
   `POST /api/add`). `/api/add` refuse les schémas `exe:`/`file:`/`local:`.
3. **Secrets au repos.** Tokens MCP/add et mot de passe WebDAV chiffrés par
   **DPAPI** (`dpapi1:…`) lié au profil Windows ; jamais journalisés (seuls des
   noms de clés apparaissent dans les logs). Dégradation visible si DPAPI
   indisponible.
4. **Contenu distant rendu** (notes riches, README GitHub). Passé par
   `sanitizeHtml` (allowlist de balises + `href`/`src` limités à http/https/
   mailto/#) ; le README est de plus filtré au schéma de lien et ses clics
   routés vers le navigateur externe (jamais une navigation de la webview).
   CSP `script-src 'self'` bloque l'injection de script inline en production.
5. **Imports.** Backup JSON restauré **validé** : impossible de faire passer un
   lanceur `exe:`/`.bat` sur une tuile non-« app » (URL **et** `meta`
   contrôlés). Imports HTML/CSV parsés en code pur borné, sans dépendance DOM.

## Mesures anti-abus / DoS

- **Rate-limit** : `AddRateLimiter` sur `/api/add` (30/min) **et** `/mcp`
  (240/min, après authentification).
- **`check_dead_links`** en **single-flight** (un seul scan à la fois) et
  **concurrence bornée** (sémaphore 32).
- **SSRF** : les fetch sortants vers une URL utilisateur (métadonnées, liens
  morts) utilisent un client **`redirect(none)`** et un **filtre d'hôte** qui
  rejette loopback / RFC1918 / CGNAT / link-local (dont IMDS
  `169.254.169.254`) / IPv6 uniques-locaux / mapped-loopback / noms
  `.local`/`.internal`/`metadata`. Le corps est plafonné en flux (200 ko).
  Volontairement **sans** DNS-rebind blocking complet (coût/bénéfice pour un
  desktop mono-utilisateur) et **sans** filtrer WebDAV (NAS en IP locale = cas
  d'usage légitime).
- **Lancement d'exécutable** : liste blanche d'extensions `exe/lnk/bat/cmd` et
  le chemin vient **de la base**, jamais d'un argument du JS. Via **token MCP**,
  `launch_app` est restreint aux **`.exe`** (les `.bat/.cmd/.lnk` exigent un clic
  dans l'UI).
- **Personnalisation** : une image de fond est réinjectée en CSS `url("…")` ; la
  valeur est validée `data:image/` **sans** aucun `"` `)` `\` (anti cassure de la
  fonction CSS / injection de déclarations).

## Mise à jour

`tauri-plugin-updater`, endpoint **GitHub Releases**. La **signature minisign
est toujours vérifiée** ; un `pubkey` vide rend l'installation **impossible
(fail-closed)** — pas de mise à jour non signée/pivotable. Publier v1.0.0
nécessite donc d'abord de configurer une clé (`tauri signer generate`,
`plugins.updater.pubkey`, secrets de build).

## Limites assumées (modèle de menace desktop)

- Un **malware exécuté sous le même compte Windows** peut lire la base, déchiffrer
  DPAPI et appeler le serveur local muni du token : c'est « game over » sur toute
  app desktop, hors périmètre.
- Le **token MCP** donne CRUD complet + `launch_app` : à traiter comme un secret.
  « Régénérer » est disponible instantanément (lecture en direct, sans
  redémarrage).
- DNS-rebind **total** sur les fetch sortants non couverts (voir SSRF ci-dessus).

## Journal des décisions de sécurité

- Les rejets `open_url`/`open_path` et la garde `exe:` par type sont **testés**
  (`commands.rs`, `server.rs`). Les gardes d'hôte SSRF, de schéma de lien
  (`sanitize.ts`) et de data URL de fond (`appearance.ts`) sont également testées.
