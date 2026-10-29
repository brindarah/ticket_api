# Support Ticket API

API REST de gestion de tickets de support technique, développée avec Node.js, Express et TypeScript. Le projet utilise Zod pour la validation des données et Prisma avec PostgreSQL pour la persistance.

## Sommaire

- [Présentation](#présentation)
- [Fonctionnalités](#fonctionnalités)
- [Technologies](#technologies)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture du projet](#architecture-du-projet)
- [Modèle de données](#modèle-de-données)
- [Endpoints API](#endpoints-api)
- [Validation des données](#validation-des-données)
- [Tests avec Insomnia](#tests-avec-insomnia)
- [Conventions de développement](#conventions-de-développement)
- [Contribution](#contribution)

## Présentation

Support Ticket API permet de gérer des tickets de support à travers une API REST.

Le projet a pour objectif de proposer un backend organisé, maintenable et testable, avec une séparation claire entre les routes HTTP, les contrôleurs, la logique métier et l'accès aux données.

## Fonctionnalités

- Créer un ticket de support.
- Consulter la liste des tickets.
- Récupérer un ticket par son identifiant.
- Modifier le statut d'un ticket.
- Valider les données entrantes avec Zod.
- Persister les données dans PostgreSQL avec Prisma.

## Technologies

| Technologie | Utilisation |
|---|---|
| Node.js | Exécution du serveur |
| Express | Gestion des routes HTTP |
| TypeScript | Typage statique |
| Zod | Validation des données à l'exécution |
| Prisma | Accès à la base de données |
| PostgreSQL | Stockage des données |
| Insomnia | Tests manuels des endpoints |

## Prérequis

Installer les outils suivants avant de commencer :

- [Node.js](https://nodejs.org/) — version compatible avec le projet.
- npm — généralement fourni avec Node.js.
- [Git](https://git-scm.com/).
- [PostgreSQL](https://www.postgresql.org/).
- [Insomnia](https://insomnia.rest/).
- Un éditeur de code, par exemple [Visual Studio Code](https://code.visualstudio.com/).

Vérifier les installations :

```bash
node --version
npm --version
git --version
```

## Installation

### 1. Cloner le dépôt

Avec HTTPS :

```bash
git clone https://github.com/brindarah/ticket_api.git
cd ticket_api
```

Avec SSH, si une clé SSH est configurée pour GitHub :

```bash
git clone git@github.com:brindarah/ticket_api.git
cd ticket_api
```

Si le dépôt est privé, disposer d'un accès autorisé.

### 2. Installer les dépendances

À la racine du projet :

```bash
npm install
```

### 3. Configurer les variables d'environnement

Créer un fichier `.env` à partir du fichier `.env.example`, si celui-ci est fourni.

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/ticket_api?schema=public"
PORT=3000
```

Remplacer les valeurs de connexion par celles de l'environnement local.

Ne jamais publier les identifiants de la base de données dans le dépôt.

### 4. Préparer la base de données

Créer une base PostgreSQL nommée `ticket_api`, puis appliquer les migrations Prisma disponibles.

Les commandes exactes dépendent de la configuration Prisma du projet. Pour un projet utilisant les migrations :

```bash
npx prisma migrate dev
```

Si nécessaire, générer le client Prisma :

```bash
npx prisma generate
```

### 5. Lancer le serveur

Utiliser le script défini dans `package.json`. Par exemple, si le projet possède un script `dev` :

```bash
npm run dev
```

L'API sera accessible sur `http://localhost:3000`, si le port configuré est `3000`.

## Architecture du projet

```text
ticket_api/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── routes/
│   │   └── ticket.routes.ts
│   ├── controllers/
│   │   └── ticket.controller.ts
│   ├── services/
│   │   └── ticket.service.ts
│   ├── schemas/
│   │   └── ticket.schema.ts
│   ├── middlewares/
│   │   ├── validate.middleware.ts
│   │   └── error.middleware.ts
│   ├── lib/
│   │   └── prisma.ts
│   ├── app.ts
│   └── server.ts
├── tests/
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

Cette arborescence représente l'organisation cible. Les fichiers seront présents selon l'état réel du projet.

### Responsabilités des dossiers

| Élément | Responsabilité |
|---|---|
| `routes/` | Définir les endpoints et associer les middlewares et contrôleurs. |
| `controllers/` | Traiter les requêtes HTTP et construire les réponses. |
| `services/` | Contenir la logique métier. |
| `schemas/` | Définir les schémas de validation Zod. |
| `middlewares/` | Gérer les validations et les erreurs transversales. |
| `lib/` | Centraliser les composants partagés, notamment Prisma. |
| `prisma/` | Définir le modèle de données et les migrations. |
| `tests/` | Regrouper les tests automatisés. |
| `app.ts` | Configurer Express et enregistrer les middlewares et routes. |
| `server.ts` | Démarrer le serveur HTTP. |

### Flux de traitement d'une requête

```mermaid
flowchart TD
    A[Client HTTP / Insomnia] --> B[Route Express]
    B --> C[Validation Zod]
    C --> D[Controller]
    D --> E[Service]
    E --> F[Prisma]
    F --> G[(PostgreSQL)]
    G --> F
    F --> E
    E --> D
    D --> H[Réponse HTTP]
```

La route détermine le traitement à effectuer. Le middleware valide les données, le contrôleur coordonne la requête, le service applique la logique métier et Prisma communique avec PostgreSQL.

## Modèle de données

### Diagramme conceptuel

Le modèle initial repose sur une entité `Ticket`. Les champs exacts devront correspondre au schéma Prisma réellement implémenté.

```mermaid
erDiagram
    TICKET {
        string id PK
        string title
        string description
        enum status
        datetime createdAt
        datetime updatedAt
    }
```

### Description de l'entité Ticket

| Champ | Description |
|---|---|
| `id` | Identifiant unique du ticket. |
| `title` | Résumé du problème signalé. |
| `description` | Description détaillée du problème. |
| `status` | État actuel du ticket. |
| `createdAt` | Date de création. |
| `updatedAt` | Date de dernière modification. |

Les types précis, les valeurs autorisées pour `status` et la stratégie de génération de l'identifiant seront définis dans `prisma/schema.prisma`.

### Cycle de vie d'un ticket

Exemple de cycle de vie possible :

```mermaid
stateDiagram-v2
    [*] --> OPEN
    OPEN --> IN_PROGRESS
    IN_PROGRESS --> CLOSED
```

Les transitions réellement autorisées devront être définies et contrôlées par la logique métier.

## Endpoints API

Les endpoints prévus sont les suivants :

| Méthode | Endpoint | Description |
|---|---|---|
| `POST` | `/tickets` | Créer un ticket. |
| `GET` | `/tickets` | Récupérer la liste des tickets. |
| `GET` | `/tickets/:id` | Récupérer un ticket par son identifiant. |
| `PATCH` | `/tickets/:id/status` | Modifier le statut d'un ticket. |

Le préfixe global des routes et les chemins définitifs dépendront de la configuration Express.

### Exemple : créer un ticket

Requête `POST /tickets` :

```json
{
  "title": "Impossible de se connecter",
  "description": "La connexion échoue depuis ce matin."
}
```

Le serveur valide les données, crée le ticket et renvoie une réponse HTTP adaptée.

### Codes HTTP

| Code | Signification |
|---|---|
| `200 OK` | Requête traitée avec succès. |
| `201 Created` | Ressource créée. |
| `400 Bad Request` | Données invalides. |
| `404 Not Found` | Ticket introuvable. |
| `500 Internal Server Error` | Erreur serveur inattendue. |

## Validation des données

Zod valide les données reçues par l'API à l'exécution.

Les schémas sont centralisés dans `src/schemas/`. Un middleware de validation peut être réutilisé sur plusieurs routes.

Exemple de règles pour la création d'un ticket :

- `title` : chaîne non vide, entre 3 et 100 caractères.
- `description` : chaîne non vide, entre 10 et 1 000 caractères.
- `status` : valeur autorisée parmi les statuts définis par le projet, lorsqu'il est fourni par le client.

Les règles définitives doivent être cohérentes avec les contraintes métier et le schéma Prisma.

Une requête invalide doit être rejetée avant l'exécution de l'opération en base de données.

## Tests avec Insomnia

Créer une collection Insomnia nommée `Support Ticket API`.

Définir une variable d'environnement :

```json
{
  "base_url": "http://localhost:3000"
}
```

Utiliser `{{ base_url }}` pour construire les URL des requêtes.

Scénarios à tester :

1. Créer un ticket avec des données valides.
2. Rejeter un titre trop court.
3. Rejeter une description manquante ou incorrecte.
4. Lister les tickets.
5. Récupérer un ticket existant.
6. Retourner une erreur pour un identifiant inexistant.
7. Modifier le statut d'un ticket.
8. Rejeter un statut invalide.
9. Vérifier les codes HTTP et les formats des réponses.

Insomnia sert aux tests manuels. Les tests automatisés devront également être ajoutés au projet.

## Conventions de développement

### Séparation des responsabilités

- Les routes déclarent les endpoints.
- Les contrôleurs gèrent les requêtes et réponses HTTP.
- Les services contiennent la logique métier.
- Les schémas Zod définissent les règles de validation.
- Prisma gère l'accès aux données.

### Qualité du code

- Utiliser TypeScript et éviter `any` lorsque cela est possible.
- Garder les commentaires courts et utiles.
- Privilégier des noms explicites pour les variables, fonctions et fichiers.
- Centraliser la gestion des erreurs.
- Ne pas dupliquer la logique métier dans plusieurs contrôleurs.
- Ajouter des tests aux nouvelles fonctionnalités.

### Git

Créer une branche dédiée pour chaque fonctionnalité ou correction.

```bash
git switch -c feature/create-ticket
```

Après avoir effectué les changements et vérifié les tests :

```bash
git add .
git commit -m "feat: add ticket creation"
git push -u origin feature/create-ticket
```

Ouvrir ensuite une Pull Request pour faire relire les modifications avant leur intégration.

Ne jamais committer le fichier `.env`, les secrets ou les identifiants d'accès.

## Contribution

Pour contribuer au projet :

1. Cloner le dépôt et installer les dépendances.
2. Configurer les variables d'environnement.
3. Lire l'architecture et le modèle de données.
4. Créer une branche dédiée.
5. Implémenter la fonctionnalité dans les couches appropriées.
6. Ajouter ou mettre à jour les tests.
7. Vérifier que les contrôles du projet passent.
8. Ouvrir une Pull Request avec une description claire des modifications.

Avant toute modification du modèle de données, vérifier les migrations Prisma et leurs conséquences sur les données existantes.

## Licence

La licence du projet reste à définir. Les conditions de réutilisation et de distribution seront précisées lors de son choix.
