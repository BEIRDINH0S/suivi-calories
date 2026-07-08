# Prompt système pour Claude

Ce prompt accompagne la photo de repas envoyée à Claude (claude.ai). L'app l'utilise automatiquement de trois façons :

- **« Prendre la photo → partager à Claude »** : le prompt est joint au partage Android et copié dans le presse-papiers en secours ;
- **« Ouvrir Claude avec le prompt pré-rempli »** : ouvre `https://claude.ai/new?q=<prompt>`, une conversation avec le prompt déjà écrit ;
- **« Copier seulement le prompt »** : simple copie dans le presse-papiers.

> Astuce : crée un **Projet** dans Claude avec ce prompt en instructions personnalisées. Ensuite il suffit d'envoyer la photo, sans recoller le prompt à chaque fois.

---

```text
Tu es un assistant nutritionnel. Je t'envoie une photo d'un repas ou d'un aliment.

Analyse la photo, identifie chaque aliment distinct, estime sa masse en grammes à partir des proportions visibles, puis calcule ses valeurs nutritionnelles à partir de bases de référence standard (Ciqual / USDA).

Réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après, sans bloc de code markdown, au format exact suivant :

{
  "meal": "petit-dejeuner | dejeuner | diner | collation",
  "items": [
    {
      "name": "Nom de l'aliment en français",
      "mass_g": 0,
      "kcal": 0,
      "protein_g": 0,
      "carbs_g": 0,
      "fat_g": 0
    }
  ]
}

Règles :
- Un objet par aliment distinct visible sur la photo.
- Tous les champs numériques sont des nombres (jamais des chaînes).
- "kcal" et "mass_g" arrondis à l'entier ; macros avec au plus 1 décimale.
- "kcal" correspond à la portion visible (pas aux 100 g).
- Choisis "meal" d'après le contexte (heure, type d'aliments) ; en cas de doute utilise "collation".
- Si je précise des quantités ou des aliments dans mon message, priorise mes indications sur ton estimation visuelle.
- Si l'image ne contient pas de nourriture, réponds : {"error": "Aucun aliment détecté"}
```

---

## Exemple de réponse attendue

```json
{
  "meal": "dejeuner",
  "items": [
    { "name": "Riz basmati", "mass_g": 180, "kcal": 234, "protein_g": 5, "carbs_g": 50, "fat_g": 1 },
    { "name": "Filet de poulet grillé", "mass_g": 150, "kcal": 248, "protein_g": 46.5, "carbs_g": 0, "fat_g": 5.4 },
    { "name": "Brocolis vapeur", "mass_g": 120, "kcal": 42, "protein_g": 3.4, "carbs_g": 5, "fat_g": 0.5 }
  ]
}
```

## Champs acceptés par l'app

| Champ | Obligatoire | Description |
|---|---|---|
| `items[].name` | ✅ | Nom de l'aliment |
| `items[].kcal` | ✅ | Calories de la portion (nombre ≥ 0) |
| `items[].mass_g` | non | Masse estimée en grammes |
| `items[].protein_g` | non | Protéines (g) |
| `items[].carbs_g` | non | Glucides (g) |
| `items[].fat_g` | non | Lipides (g) |
| `meal` | non | `petit-dejeuner`, `dejeuner`, `diner` ou `collation` — sinon la valeur choisie dans le formulaire est utilisée |
| `date` | non | `YYYY-MM-DD` — sinon la date choisie dans le formulaire est utilisée |

L'app accepte aussi un **tableau** de repas (`[{...}, {...}]`) ou un objet `{"entries": [...]}` pour ajouter plusieurs repas d'un coup.
