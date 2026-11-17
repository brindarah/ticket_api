# VULN-004
 
**Identifiant :** VULN-004
 
**Nom de la vulnérabilité :** le serveur n'envoie pas les en-têtes de sécurité.
 
## Description
 
Un serveur peut envoyer au navigateur des consignes de sécurité (des en-têtes), par
exemple pour forcer HTTPS ou empêcher d'afficher la page cachée dans un autre site.
L'API n'en envoyait aucune
 
## Localisation
 
- `src/app.ts`, toutes les routes

## Criticité
 
**Faible** : ça ne permet pas d’attaquer directement, c’est juste une protection qui manque

## Scénario d'exploitation
 
Un faux site pourrait afficher la page `/docs` cachée dans un cadre invisible, et
faire cliquer un utilisateur dessus sans qu'il le sache
 
## Preuve d'exploitation
 
```bash
curl -I http://localhost:3000/health
```
 
Aucun en-tête de sécurité dans la réponse
 
![Aucun en-tête de sécurité](preuves/Screenshot%20from%202026-11-17%2014-04-50.png)
 
## Impact
 
Les utilisateurs sont moins protégés, et l'API ne suit pas les bonnes pratiques de
base
 
## Correction
 
J'ai ajouté le paquet `helmet`, qui ajoute tous ces en-têtes d'un coup
 
```bash
npm install helmet
```
 
Avant (`src/app.ts`) :
 
```ts
app.disable("x-powered-by");
app.use(globalLimiter);
```
 
Après :
 
```ts
import helmet from "helmet";
 
app.disable("x-powered-by");
app.use(helmet());
app.use(globalLimiter);
```
 
## Retest

Meme commande qu'avant :

```bash
curl -I http://localhost:3000/health
```

Les en-têtes de sécurité sont maintenant présents :

| En-tête | Avant | Après |
|---|---|---|
| `Content-Security-Policy` | absent | présent |
| `Strict-Transport-Security` | absent | présent |
| `X-Content-Type-Options` | absent | `nosniff` |
| `X-Frame-Options` | absent | `SAMEORIGIN` |

![En-têtes présents](preuves/Screenshot%20from%202026-11-17%2014-14-44.png)

Test automatique ajouté : `tests/securityHeaders.test.ts`

![Tests automatiques](preuves/Screenshot%20from%202026-11-17%2014-17-26.png)