# VULN-002
 
**Identifiant :** VULN-002
 
**Nom de la vulnérabilité :** on peut créer des tickets sans limite, et chaque ticket coûte de
l'argent à cause de l'IA
 
## Description
 
À chaque ticket, l'API appelle OpenAI, qui est payante. Mais il n'y avait pas de
limite sur la création de tickets, à part la limite générale (300 requêtes en
15 minutes), soit environ 1 200 tickets par heure
 
## Localisation
 
- Fichier : `src/routes/ticket.routes.ts`
- Route : `POST /tickets`

## Criticité
 
**Moyenne** : très facile à faire et ça coûte de l'argent, mais aucune donnée n'est
volée
 
## Scénario d'exploitation
 
1. Moaze se connecte
2. Il lance une boucle qui crée des tickets sans arrêt
3. Chaque ticket appelle OpenAI : la facture monte et on ne retrouve plus les vrais tickets

## Preuve d'exploitation
 
Serveur lancé avec une fausse clé, pour ne pas payer :
 
```bash
OPENAI_API_KEY="sk-fausse" npm run dev
```
 
Moaze crée 30 tickets :
 
```bash
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/tickets \
    -H "Content-Type: application/json" -H "Authorization: Bearer $MOAZE" \
    -d "{\"title\":\"Spam $i\",\"description\":\"Ticket de spam numero $i\"}"
done; echo
```
 
Résultat : 30 fois `201`, rien n'est bloqué
 
![30 tickets créés](preuves/Screenshot%20from%202026-11-17%2011-51-01.png)
 
Le serveur a essayé d'appeler OpenAI pour chaque ticket :
 
![Un appel à OpenAI par ticket](preuves/Screenshot%20from%202026-11-17%2011-55-50.png)
 
## Impact
 
- L'entreprise : la facture OpenAI peut exploser
- L'équipe support : plein de faux tickets cachent les vrais

## Correction
 
J'ai ajouté une limite : 10 tickets par heure et par utilisateur. au dessus l'API
répond `429` et n'appelle plus OpenAI. La limite compte par utilisateur, donc
changer d'adresse IP ne sert à rien
 
Ajout dans `src/middlewares/rateLimit.ts` :
 
```ts
export function createTicketCreationLimiter({
  windowMs = 60 * MINUTE,
  limit = 10,
  force = false,
}: { windowMs?: number; limit?: number; force?: boolean } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (_req, res) => `user:${res.locals.user.id}`,
    skip: () => !force && process.env.RATE_LIMIT_DISABLED === "true",
    handler: (_req, _res, next) =>
      next(new HttpError(429, "Too many tickets created, please try again later")),
  });
}
 
export const ticketCreationLimiter = createTicketCreationLimiter();
```
 
Avant (`src/routes/ticket.routes.ts`) :
 
```ts
router.post("/", validate(createTicketSchema, "body"), createTicket);
```
 
Après :
 
```ts
router.post("/", ticketCreationLimiter, validate(createTicketSchema, "body"), createTicket);
```
 
## Retest

La meme boucle de 30 tickets, toujours avec la fausse clé :

```bash
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/tickets \
    -H "Content-Type: application/json" -H "Authorization: Bearer $MOAZE" \
    -d "{\"title\":\"Spam $i\",\"description\":\"Ticket de spam numero $i\"}"
done; echo
```

Résultat : 10 fois `201`, puis 20 fois `429`

![10 acceptés puis bloqué](preuves/Screenshot%20from%202026-11-17%2014-33-22.png)

Test automatique ajouté : `tests/ticketRateLimit.test.ts`

![Tests automatiques](preuves/Screenshot%20from%202026-11-17%2014-35-53.png)