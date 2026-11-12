import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { seedSuperAdmin } from "../prisma/seed";
import { createTestContext } from "./helpers/testContext";

// Audit logs : statut des tickets, (dés)activation des comptes, création du Super Admin (base de test)
const ctx = createTestContext();
const unknownId = "00000000-0000-4000-8000-000000000000";

let owner: { id: string };
let ownerToken: string;
let otherToken: string;
let admin: { id: string };
let adminToken: string;

const auditsFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });

const newTicket = async () =>
  (await prisma.ticket.create({ data: { title: "Audit", description: "Audit", createdById: owner.id } })).id;

const patchTicket = (id: string, status: unknown, token: string) =>
  ctx.request("PATCH", `/tickets/${id}/status`, { status }, token);

const setUserStatus = (id: string, status: unknown, token = adminToken) =>
  ctx.request("PATCH", `/users/${id}/status`, { status }, token);

// Aucune valeur sensible ne doit apparaître dans une entrée d'audit
const assertNoSecret = (audit: object) => {
  const json = JSON.stringify(audit).toLowerCase();
  for (const word of ["password", "token", "hash", "secret", "$2"]) {
    assert.equal(json.includes(word), false, `l'audit contient "${word}"`);
  }
};

before(async () => {
  await ctx.start();
  ({ user: owner, accessToken: ownerToken } = await ctx.createUser({ name: "audit-owner" }));
  ({ accessToken: otherToken } = await ctx.createUser({ name: "audit-other" }));
  ({ user: admin, accessToken: adminToken } = await ctx.createUser({ name: "audit-admin", role: "SUPER_ADMIN" }));
});
beforeEach(() => ctx.resetEmail());
after(() => ctx.stop());

describe("Audit : statut d'un ticket", () => {
  test("une modification par le créateur crée un audit avec l'acteur, l'ancien et le nouveau statut", async () => {
    const id = await newTicket();
    assert.equal((await patchTicket(id, "IN_PROGRESS", ownerToken)).status, 200);

    const audits = await auditsFor(id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, owner.id);
    assert.equal(audits[0].action, "TICKET_STATUS_CHANGED");
    assert.equal(audits[0].entityType, "TICKET");
    assert.equal(audits[0].entityId, id);
    assert.deepEqual(audits[0].oldValue, { status: "OPEN" });
    assert.deepEqual(audits[0].newValue, { status: "IN_PROGRESS" });
    assert.ok(audits[0].createdAt instanceof Date);
    assertNoSecret(audits[0]);
  });

  test("une modification par un SUPER_ADMIN est attribuée au SUPER_ADMIN", async () => {
    const id = await newTicket();
    assert.equal((await patchTicket(id, "CLOSED", adminToken)).status, 200);
    const [audit] = await auditsFor(id);
    assert.equal(audit.actorId, admin.id);
  });

  test("chaque modification successive ajoute un audit", async () => {
    const id = await newTicket();
    await patchTicket(id, "IN_PROGRESS", ownerToken);
    await patchTicket(id, "RESOLVED", ownerToken);
    const audits = await auditsFor(id);
    assert.equal(audits.length, 2);
    assert.deepEqual(audits.map((a) => [a.oldValue, a.newValue]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [
      [{ status: "IN_PROGRESS" }, { status: "RESOLVED" }],
      [{ status: "OPEN" }, { status: "IN_PROGRESS" }],
    ]);
  });

  test("aucun audit pour une modification refusée (403), invalide (400) ou sans effet", async () => {
    const id = await newTicket();
    assert.equal((await patchTicket(id, "CLOSED", otherToken)).status, 403);
    assert.equal((await patchTicket(id, "DONE", ownerToken)).status, 400);
    assert.equal((await ctx.request("PATCH", `/tickets/${id}/status`, { status: "CLOSED" })).status, 401);
    assert.equal((await patchTicket(id, "OPEN", ownerToken)).status, 200); // même statut
    assert.equal((await auditsFor(id)).length, 0);
  });

  test("aucun audit pour un ticket inexistant (404)", async () => {
    assert.equal((await patchTicket(unknownId, "CLOSED", adminToken)).status, 404);
    assert.equal((await auditsFor(unknownId)).length, 0);
  });

  test("la création et la consultation d'un ticket ne sont pas auditées", async () => {
    const res = await ctx.request("POST", "/tickets", { title: "Pas d'audit", description: "x" }, ownerToken);
    const { id } = await res.json();
    await ctx.request("GET", `/tickets/${id}`, undefined, otherToken);
    assert.equal((await auditsFor(id)).length, 0);
  });
});

describe("Audit : gestion des comptes", () => {
  test("la désactivation crée un audit USER_DISABLED attribué au SUPER_ADMIN", async () => {
    const { user } = await ctx.createUser({ name: "audit-disable", password: "password123" });
    assert.equal((await setUserStatus(user.id, "DISABLED")).status, 200);

    const audits = await auditsFor(user.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "USER_DISABLED");
    assert.equal(audits[0].entityType, "USER");
    assert.equal(audits[0].actorId, admin.id);
    assert.deepEqual(audits[0].oldValue, { status: "ACTIVE" });
    assert.deepEqual(audits[0].newValue, { status: "DISABLED" });
    assertNoSecret(audits[0]);
  });

  test("la réactivation crée un audit USER_REACTIVATED (ACTIVE si le compte a un mot de passe)", async () => {
    const { user } = await ctx.createUser({ name: "audit-react", status: "DISABLED", password: "password123" });
    assert.equal((await setUserStatus(user.id, "ACTIVE")).status, 200);

    const audits = await auditsFor(user.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "USER_REACTIVATED");
    assert.equal(audits[0].actorId, admin.id);
    assert.deepEqual(audits[0].oldValue, { status: "DISABLED" });
    assert.deepEqual(audits[0].newValue, { status: "ACTIVE" });
    assertNoSecret(audits[0]);
  });

  test("réactiver un compte sans mot de passe enregistre le retour en INVITED", async () => {
    const { user } = await ctx.createUser({ name: "audit-react-inv", status: "DISABLED" });
    assert.equal((await setUserStatus(user.id, "ACTIVE")).status, 200);
    const [audit] = await auditsFor(user.id);
    assert.deepEqual(audit.newValue, { status: "INVITED" });
  });

  test("désactiver un utilisateur invité enregistre l'ancien statut INVITED", async () => {
    const { user } = await ctx.createUser({ name: "audit-dis-inv", status: "INVITED" });
    assert.equal((await setUserStatus(user.id, "DISABLED")).status, 200);
    const [audit] = await auditsFor(user.id);
    assert.deepEqual(audit.oldValue, { status: "INVITED" });
  });

  test("aucun audit pour une demande sans effet ou refusée", async () => {
    const { user: disabled } = await ctx.createUser({ name: "audit-noop", status: "DISABLED" });
    assert.equal((await setUserStatus(disabled.id, "DISABLED")).status, 200); // déjà désactivé
    const { user: invited } = await ctx.createUser({ name: "audit-409", status: "INVITED" });
    assert.equal((await setUserStatus(invited.id, "ACTIVE")).status, 409);
    assert.equal((await setUserStatus(admin.id, "DISABLED")).status, 403); // soi-même
    const { user: target, accessToken } = await ctx.createUser({ name: "audit-403" });
    assert.equal((await setUserStatus(target.id, "DISABLED", accessToken)).status, 403); // pas Super Admin
    assert.equal((await setUserStatus(unknownId, "DISABLED")).status, 404);

    for (const id of [disabled.id, invited.id, admin.id, target.id, unknownId]) {
      assert.equal((await prisma.auditLog.count({ where: { entityType: "USER", entityId: id } })), 0);
    }
  });
});

describe("Audit : création du Super Admin par le seed", () => {
  test("audite la création réelle avec un acteur null, sans mot de passe", async () => {
    const email = ctx.testEmail("seed-admin");
    const result = await seedSuperAdmin(email, "MotDePasseDuSeed123");
    assert.equal(result.created, true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.role, "SUPER_ADMIN");
    const audits = await auditsFor(user.id);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "SUPER_ADMIN_CREATED");
    assert.equal(audits[0].entityType, "USER");
    assert.equal(audits[0].actorId, null);
    assert.equal(audits[0].oldValue, null);
    assert.deepEqual(audits[0].newValue, { role: "SUPER_ADMIN", status: "ACTIVE" });
    assertNoSecret(audits[0]);
    assert.equal(JSON.stringify(audits[0]).includes("MotDePasseDuSeed123"), false);
  });

  test("n'audite rien et ne modifie rien si le Super Admin existe déjà", async () => {
    const email = ctx.testEmail("seed-existing");
    await seedSuperAdmin(email, "PremierMotDePasse1");
    const before = await prisma.user.findUniqueOrThrow({ where: { email } });

    const result = await seedSuperAdmin(email, "AutreMotDePasse2");
    assert.equal(result.created, false);

    const afterSeed = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(afterSeed.password, before.password);
    assert.equal((await auditsFor(before.id)).length, 1);
  });
});
