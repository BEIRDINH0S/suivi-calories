# Kcal — Suivi de calories minimaliste

Application web statique pour suivre ses calories et ses repas au fil des jours, semaines, mois et années. **Zéro serveur, zéro base de données, zéro coût** : tout est stocké localement dans le navigateur du téléphone, et l'hébergement est assuré gratuitement par GitHub Pages.

La reconnaissance des aliments est déléguée à **Claude** (claude.ai) via son application mobile : on photographie son repas, Claude renvoie un JSON structuré, on le colle dans l'app.

## Fonctionnement

```
📷 Photo du repas
      │
      ▼
🤖 Claude (app claude.ai) + prompt système  ──►  JSON {aliments, masses, kcal, macros}
      │
      ▼
📋 Coller le JSON dans l'app
      │
      ▼
📱 Stockage localStorage  ──►  vues Jour / Semaine / Mois / Année
```

1. **« Ajouter un repas » → « Prendre la photo → partager à Claude »** : l'app ouvre l'appareil photo (autorisation demandée au premier usage), puis le menu de partage Android — choisir **Claude**. Le prompt système est joint au partage **et** copié dans le presse-papiers en secours (certaines apps ignorent le texte accompagnant une image partagée : dans ce cas, coller le prompt dans la conversation).
2. Alternative : **« Ouvrir Claude avec le prompt pré-rempli »** ouvre `claude.ai/new?q=…` — une conversation Claude avec le prompt déjà écrit ; il ne reste qu'à joindre la photo. Encore mieux : créer un **Projet Claude** avec le prompt de [PROMPT.md](PROMPT.md) en instructions — il n'y a alors plus qu'à envoyer la photo, sans prompt.
3. **Copier le JSON** renvoyé par Claude.
4. **Retour dans l'app → coller le JSON**. Le contenu est validé en direct (nombre d'aliments et total kcal affichés avant l'ajout).
5. Consulter les totaux et graphiques par **jour, semaine, mois, année**.

Aucun appel API n'est facturé : on utilise simplement son abonnement Claude existant via l'interface.

## Format JSON attendu

```json
{
  "date": "2026-07-08",
  "meal": "dejeuner",
  "items": [
    { "name": "Riz basmati", "mass_g": 180, "kcal": 234, "protein_g": 5, "carbs_g": 50, "fat_g": 1 },
    { "name": "Filet de poulet grillé", "mass_g": 150, "kcal": 248, "protein_g": 46.5, "carbs_g": 0, "fat_g": 5.4 }
  ]
}
```

- Seuls `items[].name` et `items[].kcal` sont obligatoires.
- `date` et `meal` sont optionnels : s'ils manquent, l'app utilise la date et le repas choisis dans le formulaire d'ajout.
- Valeurs de `meal` : `petit-dejeuner`, `dejeuner`, `diner`, `collation`.
- Un tableau `[{...}, {...}]` ou `{"entries": [...]}` permet d'ajouter plusieurs repas d'un coup.

Le détail complet (règles de validation, exemple de réponse) est dans [PROMPT.md](PROMPT.md).

## Fonctionnalités

- **Vue Jour** : total kcal vs objectif (barre de progression), macros (protéines / glucides / lipides), repas groupés par type, suppression d'un aliment à l'unité.
- **Vues Semaine / Mois / Année** : graphique en barres (ligne pointillée = objectif, orange = dépassement), total, moyenne par jour suivi, nombre de jours suivis. Appuyer sur une barre ouvre le jour (ou le mois) correspondant.
- **Objectif quotidien** configurable dans les réglages (2 200 kcal par défaut).
- **Export / import JSON** pour sauvegarder ou transférer ses données (fusion sans doublons à l'import).
- **PWA installable** : « Ajouter à l'écran d'accueil » sur Android → l'app s'ouvre en plein écran et fonctionne **hors ligne** (service worker).
- **Mode sombre** automatique selon le thème du système.

## Stockage des données

Tout est dans le `localStorage` du navigateur — rien ne quitte jamais le téléphone.

| Clé | Contenu |
|---|---|
| `kcal.entries.v1` | Tableau des repas : `{ id, date, meal, items[], addedAt }` |
| `kcal.goal.v1` | Objectif quotidien en kcal |

⚠️ Effacer les données de navigation du site supprime l'historique : penser à faire un **export** régulier (Réglages → Exporter mes données).

## Structure du dépôt

```
index.html            L'app (une seule page)
css/style.css         Styles — design tokens, mode clair/sombre
js/app.js             Logique : stockage, validation JSON, rendu des vues
sw.js                 Service worker (cache hors ligne, stratégie réseau d'abord)
manifest.webmanifest  Manifeste PWA
icon.svg              Icône de l'app
PROMPT.md             Prompt système à donner à Claude + schéma JSON détaillé
```

Aucune dépendance, aucun build : du HTML/CSS/JS vanilla servi tel quel.

## Installation sur le téléphone

1. Ouvrir l'URL GitHub Pages du dépôt dans Chrome ou Samsung Internet.
2. Menu du navigateur → **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »).
3. L'app s'ouvre désormais comme une application native, y compris hors ligne.

## Déploiement (GitHub Pages)

Le site est servi depuis la racine de la branche `main` :
*Settings → Pages → Source : Deploy from a branch → `main` / `(root)`*.

Chaque `git push` sur `main` met le site à jour automatiquement.

## Développement local

N'importe quel serveur statique fait l'affaire, par exemple :

```bash
npx serve .
# ou
python -m http.server 8080
```

> Le service worker ne s'enregistre qu'en HTTPS (donc en production sur GitHub Pages) ; en local l'app fonctionne normalement, simplement sans cache hors ligne.
