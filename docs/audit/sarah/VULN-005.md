# VULN-005
 
**Identifiant :** VULN-005
 
**Nom de la vulnérabilité :** l'API accepte des mots de passe très faciles à deviner
 
## Description
 
La seule règle était « 8 caractères minimum ». Donc `12345678`, `aaaaaaaa` ou
`password` étaient acceptés
 
## Localisation
 
- `src/schemas/auth.schema.ts` et `src/schemas/invitation.schema.ts`
- Routes : `POST /auth/reset-password` et `POST /auth/accept-invitation`

## Criticité
 
**Faible** : le login est déjà protégé contre les essais en masse, et il faut que
l'utilisateur choisisse lui-même un mot de passe faible
 
## Scénario d'exploitation
 
Un utilisateur choisit `password`. Un attaquant essaie les mots de passe les plus
courants et trouve le bon facilement avec quelques essais
 
## Preuve d'exploitation
 
J'ai envoyé des mots de passe avec un faux jeton. Si la réponse est « jeton
invalide », c'est que le mot de passe a été accepté
 
```bash
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"1234567"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"12345678"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"aaaaaaaa"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"password"}'
```
 
| Mot de passe | Résultat |
|---|---|
| `1234567` | Refusé |
| `12345678` | Accepté |
| `aaaaaaaa` | Accepté |
| `password` | Accepté |
 
![Mots de passe faibles acceptés](preuves/Screenshot%20from%202026-11-17%2014-07-11.png)
 
## Impact
 
Un compte avec un mot de passe faible peut être piraté, et ses tickets peuvent etre lus
 
## Correction
 
J'ai créé une seule règle pour tous les nouveaux mots de passe : au moins une lettre
et un chiffre, pas un seul caractère qui se repete  et pas un mot de passe trop courant
 
Avant (`src/schemas/auth.schema.ts`) :
 
```ts
const newPassword = z
  .string()
  .min(8, "Le mot de passe doit faire au moins 8 caractères")
  .max(72, "Le mot de passe doit faire au plus 72 caractères");
```
 
Après (`src/schemas/password.schema.ts`, nouveau fichier) :
 
```ts
export const strongPassword = z
  .string()
  .min(8, "Le mot de passe doit faire au moins 8 caractères")
  .max(72, "Le mot de passe doit faire au plus 72 caractères")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Le mot de passe ne doit pas dépasser 72 octets")
  .regex(/[A-Za-z]/, "Le mot de passe doit contenir au moins une lettre")
  .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre")
  .refine((value) => !/^(.)\1+$/.test(value), "Le mot de passe ne doit pas être un seul caractère répété")
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), "Ce mot de passe est trop courant");
```

Puis les deux fichiers utilisent cette règle :

```ts
const newPassword = strongPassword;   // auth.schema.ts
password: strongPassword,             // invitation.schema.ts
```
 
## Retest

Les memes commandes qu'avant, avec le faux jeton :

```bash
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"1234567"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"12345678"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"aaaaaaaa"}'
curl -s -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" -d '{"token":"faux-jeton","password":"password"}'
```

| Mot de passe | Avant | Après |
|---|---|---|
| `1234567` | Refusé | Refusé |
| `12345678` | Accepté | Refusé |
| `aaaaaaaa` | Accepté | Refusé |
| `password` | Accepté | Refusé |

![Mots de passe faibles refusés](preuves/Screenshot%20from%202026-11-17%2014-27-09.png)

Test automatique ajouté : `tests/password.test.ts`

![Tests automatiques](preuves/Screenshot%20from%202026-11-17%2014-26-12.png) 
