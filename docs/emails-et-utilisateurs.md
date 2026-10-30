# Emails transactionnels et gestion des utilisateurs

Ce document décrit l'envoi d'emails avec Resend, le workflow d'invitation et la gestion des utilisateurs par le Super Admin.

Le projet est une API sans frontend. Les emails n'envoient donc vers aucune page web : ils indiquent la requête HTTP à envoyer à l'API.

## Architecture

```text
src/lib/resend.ts               Configuration (RESEND_API_KEY, EMAIL_FROM) et client Resend unique
src/services/email.service.ts   sendEmail : envoi générique, résultat explicite, jamais d'exception
src/emails/shared.ts            Utilitaires des contenus : échappement HTML, dates, bloc de requête API
src/emails/invitation.email.ts  Contenu de l'email d'invitation
src/emails/password-reset.email.ts  Contenu de l'email de réinitialisation du mot de passe
src/services/invitation.service.ts  Jetons d'invitation, envoi, acceptation, renvoi
src/services/user.service.ts    Création, liste, activation et désactivation des utilisateurs
```

Règles :

- Les contenus d'emails ne font aucun envoi. Ils ne dépendent ni de Resend, ni d'Express, ni de Prisma.
- Le service d'envoi ne contient aucune logique métier.
- Un seul client Resend existe, créé au premier envoi. Sans configuration, l'API démarre normalement et seul l'envoi échoue.

## Configuration

Toutes les variables sont listées dans `.env.example`, avec des valeurs fictives.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `RESEND_API_KEY` | pour envoyer des emails | Clé API Resend, préfixe `re_` |
| `EMAIL_FROM` | pour envoyer des emails | Expéditeur : `Nom <adresse>` ou `adresse` |
| `API_PUBLIC_URL` | non | URL de l'API affichée dans les emails |
| `JWT_ACCESS_SECRET` | oui | Signature des access tokens |
| `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | pour le seed | Compte Super Admin initial |

La configuration email est validée au moment de l'envoi. Les messages d'erreur citent le nom des variables, jamais leur valeur.

### Expéditeur et domaine

`onboarding@resend.dev` est une adresse de test. Elle n'envoie qu'à l'adresse du propriétaire du compte Resend.

Pour inviter de vrais utilisateurs :

1. Ajouter un domaine dans le tableau de bord Resend : https://resend.com/docs/dashboard/domains/introduction
2. Créer chez l'hébergeur DNS les enregistrements demandés par Resend, SPF et DKIM.
3. Attendre que Resend affiche le domaine comme vérifié.
4. Mettre une adresse de ce domaine dans `EMAIL_FROM`, par exemple `Ticket API <support@mon-domaine.fr>`.

## Service d'envoi partagé

```ts
import { sendEmail } from "../services/email.service";

const result = await sendEmail(
  { to: "awa@example.com", subject: "Sujet", text: "Version texte", html: "<p>Version HTML</p>" },
  { idempotencyKey: "password-reset-<id en base>" },
);

if (!result.ok) {
  // result.reason : "invalid_input" | "config" | "provider" | "unexpected"
  console.error("Email not sent", { reason: result.reason, providerError: result.providerError?.name });
}
```

| Résultat | Signification |
|---|---|
| `ok: true`, `status: "accepted"` | Resend a accepté l'email. La livraison au destinataire n'est pas confirmée. |
| `reason: "invalid_input"` | Paramètres invalides. Resend n'est pas appelé. |
| `reason: "config"` | `RESEND_API_KEY` ou `EMAIL_FROM` absente ou invalide. |
| `reason: "provider"` | Resend a refusé la demande ou n'a pas pu être joint. |
| `reason: "unexpected"` | Exception imprévue. L'email a pu partir ou non. |

Règles d'utilisation :

- **Toujours vérifier `result.ok`.** TypeScript l'impose avant d'accéder à `messageId`.
- **Ne jamais journaliser** le jeton, l'adresse du destinataire ni `result.message`. Le message de Resend peut contenir une adresse.
- **Ne jamais renvoyer** `result.message` au client HTTP.
- **Utiliser une clé d'idempotence stable,** liée à l'enregistrement en base. Une nouvelle tentative ne crée alors pas de doublon chez Resend.

La confirmation de livraison demanderait les webhooks Resend. Ils ne sont pas mis en place.

## Réinitialisation du mot de passe

La logique appartient à Personne 1 : `POST /auth/forgot-password` et `POST /auth/reset-password`, dans `auth.controller.ts`.

Seul l'envoi a été harmonisé. Il utilise maintenant `sendEmail` et le contenu de `password-reset.email.ts`, au lieu d'un deuxième client Resend. L'email indique la requête `POST /auth/reset-password` avec le jeton, au lieu d'un lien vers un frontend inexistant. `FRONTEND_URL` n'est plus utilisée.

Le contrat HTTP n'a pas changé. La réponse reste identique que le compte existe ou non, et que l'email parte ou non.

## Endpoints

Toutes les routes `/users` exigent un access token de Super Admin : `Authorization: Bearer <accessToken>`. Sans token, la réponse est 401. Avec un autre rôle, elle est 403.

### Créer un utilisateur et l'inviter

```http
POST /users
{ "nom": "Diallo", "prenom": "Awa", "email": "awa@example.com" }
```

- **201** : l'utilisateur est créé, avec le rôle `USER` et le statut `INVITED`. L'invitation est valable 72 heures.
- **`invitation.emailStatus`** : vaut `accepted_by_provider`, ou `failed` avec un message.
- **400** : données invalides. **409** : email déjà utilisé, quelle que soit la casse.

Si l'email échoue, l'utilisateur reste créé. La réponse le signale et il suffit de renvoyer l'invitation.

### Renvoyer une invitation

```http
POST /users/:id/invitation
```

- **201** : les invitations encore valides expirent, et une nouvelle est créée et envoyée. `usedAt` reste réservé aux invitations acceptées.
- **404** : utilisateur inconnu. **409** : l'utilisateur n'est pas `INVITED`.

### Accepter une invitation

Cette route est publique : le jeton reçu par email sert de preuve.

```http
POST /auth/accept-invitation
{ "token": "<jeton reçu par email>", "password": "<mot de passe choisi>" }
```

- **200** : le mot de passe est enregistré hashé avec bcrypt, et le compte devient `ACTIVE`. L'utilisateur se connecte ensuite avec `POST /auth/login`.
- **400** : jeton inconnu, expiré, déjà utilisé, ou compte non `INVITED`. Le message est le même dans tous les cas.
- **400** aussi pour un mot de passe de moins de 8 caractères ou de plus de 72 octets.

Le jeton est à usage unique, même pour deux requêtes simultanées.

### Lister les utilisateurs

```http
GET /users?status=ACTIVE&role=USER&page=1&limit=10
```

La réponse est `{ data, meta }`, avec `total`, `page`, `limit` et `totalPages`. Le mot de passe n'est jamais renvoyé.

### Activer ou désactiver un utilisateur

```http
PATCH /users/:id/status
{ "status": "DISABLED" }
```

- **Désactivation :** le statut devient `DISABLED`. Les refresh tokens sont révoqués et les invitations en attente expirent. L'access token est refusé dès la requête suivante.
- **Réactivation, `ACTIVE` :** le compte redevient `ACTIVE` s'il avait un mot de passe. Sinon, il redevient `INVITED` et une invitation doit être renvoyée.
- **403 :** un Super Admin ne peut changer ni son propre statut, ni celui d'un autre Super Admin. Cela évite de perdre tout accès administrateur.
- **409 :** un utilisateur `INVITED` ne peut pas être activé directement. Il doit accepter son invitation.
- **404 :** utilisateur inconnu.

## Tests

```bash
npm test
```

- Resend est toujours simulé : `setResendClientForTests` remplace le client par un faux, et la clé est remplacée par une valeur fictive. Aucun email réel n'est envoyé.
- Les tests d'intégration utilisent la base définie par `DATABASE_URL`. Ils créent des utilisateurs avec des adresses `@example.test` uniques, puis les suppriment.
- **Risque :** il n'y a pas de base de test dédiée. Ne jamais lancer les tests avec une `DATABASE_URL` de production.
