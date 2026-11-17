# VULN-003
 
**Identifiant :** VULN-003
 
**Nom de la vulnérabilité :** après la déconnexion, l'ancien token marche encore pendant 15 minutes
 
## Description
 
Au logout, seul le refresh token était annulé. L'access token n'est pas
enregistré en base, donc le serveur ne pouvait pas l'annuler : il restait valable
jusqu'à la fin de ses 15 minutes
 
## Localisation
 
- `src/middlewares/auth.ts` (fonction `authenticate`)
- `src/lib/tokens.ts`
- Route : `POST /auth/logout`

## Criticité
 
**Faible** : il faut d'abord voler le token, et il expire tout seul au bout de
15 minutes
 
## Scénario d'exploitation
 
1. Moaze se connecte sur un ordinateur partagé
2. Quelqu'un récupère son token
3. Moaze se déconnecte, mais la personne peut encore utiliser le token pendant un moment

## Preuve d'exploitation
 
```bash
LOGIN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"abbas.sarah2006+moaze@gmail.com","password":"TestAudit2026!"}')
ACCESS=$(echo "$LOGIN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")
REFRESH=$(echo "$LOGIN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).refreshToken))")
 
curl -s -o /dev/null -w "Logout : %{http_code}\n" -X POST http://localhost:3000/auth/logout \
  -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}"
curl -s -w "\nAccess token apres logout : %{http_code}\n" http://localhost:3000/auth/me \
  -H "Authorization: Bearer $ACCESS"
curl -s -w "\nRefresh token apres logout : %{http_code}\n" -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}"
```
 
Résultat : logout `204`, mais l'access token répond encore `200`
 
![Token encore valable](preuves/Screenshot%20from%202026-11-17%2014-02-47.png)
 
## Impact
 
Se déconnecter ne protège pas tout de suite. Si un token est volé, on ne peut pas
couper l'accès immédiatement
 
## Correction
 
Chaque access token est maintenant relié à sa session. À chaque
requête, on vérifie que la session est toujours ouverte. Au logout, la session est
fermée, donc le token est refusé tout de suite
 
Avant (`src/lib/tokens.ts`) :
 
```ts
export async function issueTokens(user: { id: string; role: string }) {
  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);
  return { accessToken, refreshToken };
}
```
 
Après :
 
```ts
export async function issueTokens(user: { id: string; role: string }) {
  const session = await createRefreshToken(user.id);
  const accessToken = signAccessToken(user, session.id);
  return { accessToken, refreshToken: session.token };
}
```
 
Ajout dans `authenticate` (`src/middlewares/auth.ts`) :
 
```ts
if (!payload.sid || !(await isSessionActive(payload.sid, payload.sub))) {
  throw new HttpError(401, "Invalid or expired token");
}
```
 
## Retest

Moaze se reconnecte, puis j'ai refait le test, en ajoutant un appel avant le logout
pour montrer que le token marche bien au départ :

```bash
curl -s -w "\nAccess token AVANT logout : %{http_code}\n" http://localhost:3000/auth/me \
  -H "Authorization: Bearer $ACCESS"
curl -s -o /dev/null -w "Logout : %{http_code}\n" -X POST http://localhost:3000/auth/logout \
  -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}"
curl -s -w "\nAccess token apres logout : %{http_code}\n" http://localhost:3000/auth/me \
  -H "Authorization: Bearer $ACCESS"
curl -s -w "\nRefresh token apres logout : %{http_code}\n" -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" -d "{\"refreshToken\":\"$REFRESH\"}"
```

| Étape | Avant | Après |
|---|---|---|
| Token avant logout | 200 | 200 |
| Logout | 204 | 204 |
| Token après logout | 200 | 401 |
| Refresh après logout | 401 | 401 |

![Token refusé après logout](preuves/Screenshot%20from%202026-11-17%2014-44-51.png)

Test automatique ajouté : `tests/logoutAccess.test.ts`

![Tests automatiques](preuves/Screenshot%20from%202026-11-17%2014-46-40.png)