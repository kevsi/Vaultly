# Politique de confidentialité — Vaultly (extension navigateur)

*Dernière mise à jour : 8 septembre 2026*

## En bref

L'extension Vaultly **ne collecte aucune donnée personnelle** et n'envoie
rien vers un serveur distant. Tout reste sur ta machine.

## Ce que fait l'extension

- Lit l'**URL et le titre de l'onglet actif** (`activeTab`) lorsque tu cliques
  sur son icône, pour les préremplir dans son popup
- Mémorise **localement** (`chrome.storage.local`) :
  - le *token d'ajout* que tu y colles toi-même depuis l'application Vaultly
    (Réglages → Extension), nécessaire pour t'authentifier auprès de l'app,
  - tes tags habituels et le port local déjà trouvé
- Envoie `{ url, title, tags }` **uniquement à l'application Vaultly tournant
  sur ta propre machine** (`http://127.0.0.1:8765` à `8780`), via
  `POST /api/add`

## Ce que l'extension ne fait pas

- Aucune donnée n'est envoyée à Vaultly ou à un tiers (pas d'analytics,
  pas de télémétrie, pas de publicité)
- Aucune lecture de l'historique de navigation, des cookies ou d'autres onglets
- Aucune vente ou partage de données, quelle qu'en soit la forme

## Application de bureau

La politique de confidentialité de l'application de bureau Vaultly (favoris,
captures d'écran optionnelles, sauvegarde Google Drive optionnelle) est
décrite dans le [README du projet](https://github.com/kevsi/Vaultly#fonctionnalit%C3%A9s).

## Contact

Ouvre une issue sur <https://github.com/kevsi/Vaultly/issues>.
