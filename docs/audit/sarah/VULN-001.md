# VULN-001
 
**Nom :** un utilisateur peut lire les tickets des autres
 
## Description
 
L'API vérifie que l'utilisateur est connecté, mais pas que le ticket lui
appartient. Donc avec n'importe quel compte on peut lire tous les tickets
Et cette faille s'appelle IDOR 
 
## Localisation
 
- Fichier : `src/services/ticket.service.ts`
- Fonctions : `getTicketById` et `listTickets`
- Routes : `GET /tickets/:id` et `GET /tickets`

## Criticité
 
**Élevée** : c'est très facile, juste avec un compte normal suffit et les tickets contiennent
des informations personnelles. Mais c'est pas critique parce qu'on peut seulement lire et pas
le modifier
 
## Scénario d'exploitation
 
1. Moaze se connecte avec son compte normal
2. Il demande la liste des tickets et il voit ceux de tout le monde
3. Il ouvre le ticket d'Alice et lit son adresse
## Preuve
 
Alice crée un ticket avec son adresse :
 
```bash
TICKET=$(curl -s -X POST http://localhost:3000/tickets \
  -H "Content-Type: application/json" -H "Authorization: Bearer $ALICE" \
  -d '{"title":"Probleme de VPN","description":"Je n arrive plus a me connecter au VPN depuis chez moi, mon adresse est 12 rue des Lilas."}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
```
 
Moaze ouvre le ticket d'Alice :
 
```bash
curl -i http://localhost:3000/tickets/$TICKET -H "Authorization: Bearer $MOAZE"
```
 
Il reçoit `200` et voit tout le ticket, avec l'adresse d'Alice
 
![Moaze lit le ticket d'Alice](preuves/Screenshot%20from%202026-11-17%2011-13-40.png)
 
Moaze demande la liste :
 
```bash
curl http://localhost:3000/tickets -H "Authorization: Bearer $MOAZE"
```
 
Il voit 3 tickets (ceux d'Alice et celui du Super Admin) alors qu'il n'en a créé
aucun
 
![Moaze voit tous les tickets](preuves/Screenshot%20from%202026-11-17%2011-16-41.png)
 
## Impact
 
- Les utilisateurs : leurs informations personnelles sont visibles par tous, et
  pourraient servir à les arnaquer
- L'entreprise : elle ne protège pas les données personnelles (RGPD), elle risque
  une amende et aussi de perdre la confiance de ses clients
  
## Correction
 
Les fonctions reçoivent maintenant l'utilisateur connecté. Un USER ne voit que ses
tickets, le Super Admin voit tout. Le ticket de quelqu'un d'autre renvoie `404`,
pour ne même pas dire qu'il existe
 
Avant :
 
```ts
export const getTicketById = async (id: string) => {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: ticketSelect });
  if (!ticket) throw ticketNotFound();
  return ticket;
};
```
 
Après :
 
```ts
export const getTicketById = async (actor: TicketActor, id: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id, ...(actor.role !== "SUPER_ADMIN" && { createdById: actor.id }) },
    select: ticketSelect,
  });
  if (!ticket) throw ticketNotFound();
  return ticket;
};
```
 
pareil pour la liste :
 
```ts
const where: Prisma.TicketWhereInput = {
  ...(status && { status }),
  ...(actor.role !== "SUPER_ADMIN" && { createdById: actor.id }),
};
```
 
J'ai aussi modifié deux anciens tests qui vérifiaient l'ancien comportement
 
## Retest
 
```bash
curl -s -o /dev/null -w "Alice lit SON ticket : %{http_code}\n" \
  http://localhost:3000/tickets/$TICKET -H "Authorization: Bearer $ALICE"
curl -s -w "\nMoaze lit le ticket d'Alice : %{http_code}\n" \
  http://localhost:3000/tickets/$TICKET -H "Authorization: Bearer $MOAZE"
echo "Tickets d'Alice dans la liste de Moaze : $(curl -s "http://localhost:3000/tickets?limit=100" \
  -H "Authorization: Bearer $MOAZE" | grep -o "Lilas" | wc -l)"
```
 
| Test | Avant | Après |
|---|---|---|
| Alice lit son ticket | 200 | 200 |
| Moaze lit le ticket d'Alice | 200 | 404 |
| Tickets d'Alice chez Moaze | 2 | 0 |
 
![Retest](preuves/Screenshot%20from%202026-11-17%2015-08-08.png)
 
Test automatique ajouté : `tests/ticketAccess.test.ts`. Les 191 tests passent
 
![Tests automatiques](preuves/Screenshot%20from%202026-11-17%2015-06-43.png)
