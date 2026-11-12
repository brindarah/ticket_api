import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { createTestContext } from "./helpers/testContext";

// Tickets : authentification, propriétaire et droits de modification (base de test)
const ctx = createTestContext();
const unknownId = "00000000-0000-4000-8000-000000000000";

let owner: { id: string; prenom: string; nom: string };
let ownerToken: string;
let otherToken: string;
let adminToken: string;
let ticketId: string;

const valid = { title: "Connexion impossible", description: "Erreur 500 au login" };

// Crée un ticket appartenant à `owner`, directement en base
const createOwnedTicket = async (title = "Test ticket") =>
  (await prisma.ticket.create({ data: { title, description: "Créé par les tests", createdById: owner.id } })).id;

before(async () => {
  await ctx.start();
  ({ user: owner, accessToken: ownerToken } = await ctx.createUser({ name: "owner" }));
  ({ accessToken: otherToken } = await ctx.createUser({ name: "other" }));
  ({ accessToken: adminToken } = await ctx.createUser({ name: "admin", role: "SUPER_ADMIN" }));
  ticketId = await createOwnedTicket();
});
after(() => ctx.stop());

describe("/tickets : authentification obligatoire", () => {
  test("retourne 401 sans access token sur toutes les routes", async () => {
    const calls = [
      ctx.request("POST", "/tickets", valid),
      ctx.request("GET", "/tickets"),
      ctx.request("GET", `/tickets/${ticketId}`),
      ctx.request("PATCH", `/tickets/${ticketId}/status`, { status: "CLOSED" }),
    ];
    for (const res of await Promise.all(calls)) {
      assert.equal(res.status, 401);
    }
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(ticket.status, "OPEN");
  });

  test("retourne 401 avec un token invalide", async () => {
    const res = await ctx.request("GET", "/tickets", undefined, "pas-un-jwt");
    assert.equal(res.status, 401);
  });
});

describe("POST /tickets", () => {
  test("crée le ticket au nom de l'utilisateur connecté, avec le statut OPEN", async () => {
    const res = await ctx.request("POST", "/tickets", valid, ownerToken);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.title, valid.title);
    assert.equal(body.status, "OPEN");
    assert.equal(body.createdById, owner.id);
    assert.deepEqual(body.createdBy, { id: owner.id, nom: owner.nom, prenom: owner.prenom });
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(stored.createdById, owner.id);
  });

  test("ne renvoie jamais l'email du créateur", async () => {
    const res = await ctx.request("POST", "/tickets", valid, ownerToken);
    const body = await res.json();
    assert.equal("email" in body, false);
    assert.equal("email" in body.createdBy, false);
    assert.equal(JSON.stringify(body).includes(ctx.testEmail("owner")), false);
  });

  test("rejette un createdById envoyé par le client, sans rien créer", async () => {
    const before = await prisma.ticket.count({ where: { createdById: owner.id } });
    const res = await ctx.request("POST", "/tickets", { ...valid, createdById: owner.id }, otherToken);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "Validation failed");
    assert.equal(await prisma.ticket.count({ where: { createdById: owner.id } }), before);
  });

  test("rejette un champ email envoyé par le client", async () => {
    const res = await ctx.request("POST", "/tickets", { ...valid, email: "user@example.test" }, ownerToken);
    assert.equal(res.status, 400);
  });

  test("rejette les autres champs inconnus (ex. status, priority)", async () => {
    assert.equal((await ctx.request("POST", "/tickets", { ...valid, status: "CLOSED" }, ownerToken)).status, 400);
    assert.equal((await ctx.request("POST", "/tickets", { ...valid, priority: "HIGH" }, ownerToken)).status, 400);
  });

  test("retourne 400 pour un titre trop court ou une description absente", async () => {
    const short = await ctx.request("POST", "/tickets", { ...valid, title: "ab" }, ownerToken);
    assert.equal(short.status, 400);
    assert.equal((await short.json()).details[0].field, "title");
    const missing = await ctx.request("POST", "/tickets", { title: valid.title }, ownerToken);
    assert.equal(missing.status, 400);
  });
});

describe("GET /tickets/:id", () => {
  test("un autre utilisateur connecté peut consulter le ticket", async () => {
    const res = await ctx.request("GET", `/tickets/${ticketId}`, undefined, otherToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ticketId);
    assert.equal(body.createdById, owner.id);
    assert.equal("email" in body.createdBy, false);
  });

  test("retourne 404 si le ticket n'existe pas", async () => {
    const res = await ctx.request("GET", `/tickets/${unknownId}`, undefined, ownerToken);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Ticket not found" });
  });

  test("retourne 400 si l'identifiant n'est pas un UUID", async () => {
    const res = await ctx.request("GET", "/tickets/abc", undefined, ownerToken);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "id");
  });
});

describe("GET /tickets", () => {
  test("un utilisateur voit aussi les tickets des autres", async () => {
    const res = await ctx.request("GET", "/tickets?limit=100", undefined, otherToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.some((t: { id: string }) => t.id === ticketId));
  });
});

describe("PATCH /tickets/:id/status", () => {
  const patch = (id: string, body: unknown, token: string) =>
    ctx.request("PATCH", `/tickets/${id}/status`, body, token);

  test("le créateur peut modifier le statut de son ticket", async () => {
    const id = await createOwnedTicket();
    const res = await patch(id, { status: "IN_PROGRESS" }, ownerToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.equal(body.status, "IN_PROGRESS");
    assert.equal(body.createdById, owner.id);
  });

  test("un autre utilisateur reçoit 403 et le ticket n'est pas modifié", async () => {
    const id = await createOwnedTicket();
    const res = await patch(id, { status: "CLOSED" }, otherToken);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "You can only change the status of your own tickets" });
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    assert.equal(ticket.status, "OPEN");
  });

  test("un SUPER_ADMIN peut modifier le statut du ticket d'un autre utilisateur", async () => {
    const id = await createOwnedTicket();
    const res = await patch(id, { status: "RESOLVED" }, adminToken);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "RESOLVED");
  });

  test("le même statut renvoie 200 sans modification", async () => {
    const id = await createOwnedTicket();
    const res = await patch(id, { status: "OPEN" }, ownerToken);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "OPEN");
  });

  test("retourne 404 si le ticket n'existe pas, y compris pour un SUPER_ADMIN", async () => {
    for (const token of [ownerToken, adminToken]) {
      const res = await patch(unknownId, { status: "CLOSED" }, token);
      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "Ticket not found" });
    }
  });

  test("ignore un rôle ou un identifiant envoyés dans le body : 400 et rien n'est modifié", async () => {
    const id = await createOwnedTicket();
    const res = await patch(id, { status: "CLOSED", role: "SUPER_ADMIN", createdById: "x" }, otherToken);
    assert.equal(res.status, 400);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    assert.equal(ticket.status, "OPEN");
  });

  test("retourne 400 pour un statut invalide ou absent", async () => {
    const invalid = await patch(ticketId, { status: "DONE" }, ownerToken);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).details[0].field, "status");
    assert.equal((await patch(ticketId, {}, ownerToken)).status, 400);
  });

  test("retourne 400 si d'autres champs sont envoyés et ne modifie rien", async () => {
    const res = await patch(ticketId, { status: "CLOSED", title: "Titre piraté" }, ownerToken);
    assert.equal(res.status, 400);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    assert.equal(ticket.title, "Test ticket");
    assert.equal(ticket.status, "OPEN");
  });

  test("retourne 400 si l'identifiant n'est pas un UUID", async () => {
    assert.equal((await patch("abc", { status: "CLOSED" }, ownerToken)).status, 400);
  });

  test("deux modifications simultanées : chacune réussit ou reçoit 409, jamais de résultat incohérent", async () => {
    const id = await createOwnedTicket();
    const responses = await Promise.all([
      patch(id, { status: "IN_PROGRESS" }, ownerToken),
      patch(id, { status: "CLOSED" }, adminToken),
    ]);
    const codes = responses.map((r) => r.status);
    assert.ok(codes.every((c) => c === 200 || c === 409), `codes inattendus : ${codes}`);
    assert.ok(codes.includes(200));
    // Chaque modification réussie a exactement un audit, et les audits forment une chaîne
    // cohérente : OPEN -> ... -> statut final (aucun audit ne part d'un statut périmé)
    const audits = await prisma.auditLog.findMany({ where: { entityId: id } });
    assert.equal(audits.length, codes.filter((c) => c === 200).length);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    let current = "OPEN";
    const remaining = [...audits];
    while (remaining.length > 0) {
      const index = remaining.findIndex((a) => (a.oldValue as { status: string }).status === current);
      assert.notEqual(index, -1, "chaîne d'audits incohérente");
      current = (remaining.splice(index, 1)[0].newValue as { status: string }).status;
    }
    assert.equal(current, ticket.status);
  });
});
