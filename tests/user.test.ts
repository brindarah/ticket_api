import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { INVITATION_VALIDITY_HOURS } from "../src/services/invitation.service";
import { createTestContext, sha256, tokenFromEmail } from "./helpers/testContext";

// Création d'un utilisateur invité (POST /users). Base réelle, Resend toujours simulé.
const ctx = createTestContext();
let adminToken: string;
let userToken: string;

const post = (body: unknown, token?: string) => ctx.request("POST", "/users", body, token);

before(async () => {
  await ctx.start();
  adminToken = (await ctx.createUser({ name: "admin", role: "SUPER_ADMIN" })).accessToken;
  userToken = (await ctx.createUser({ name: "user" })).accessToken;
});
beforeEach(() => ctx.resetEmail());
afterEach(() => mock.restoreAll());
after(() => ctx.stop());

describe("POST /users : autorisation", () => {
  test("retourne 401 sans access token", async () => {
    const res = await post({ nom: "A", prenom: "B", email: ctx.testEmail("noauth") });
    assert.equal(res.status, 401);
    assert.equal(ctx.sendCalls.length, 0);
  });

  test("retourne 403 pour un utilisateur qui n'est pas Super Admin", async () => {
    const res = await post({ nom: "A", prenom: "B", email: ctx.testEmail("forbidden") }, userToken);
    assert.equal(res.status, 403);
    assert.equal(await prisma.user.count({ where: { email: ctx.testEmail("forbidden") } }), 0);
  });
});

describe("POST /users : validation", () => {
  test("retourne 400 pour un email invalide", async () => {
    const res = await post({ nom: "Diallo", prenom: "Awa", email: "pas-un-email" }, adminToken);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "email");
  });

  test("retourne 400 si le nom ou le prénom manquent", async () => {
    const res = await post({ email: ctx.testEmail("incomplete") }, adminToken);
    assert.equal(res.status, 400);
    const fields = (await res.json()).details.map((d: { field: string }) => d.field);
    assert.deepEqual(fields.sort(), ["nom", "prenom"]);
  });
});

describe("POST /users : création et invitation", () => {
  test("crée un utilisateur INVITED, stocke le hash du jeton et envoie l'invitation", async () => {
    const email = ctx.testEmail("awa");
    const before = Date.now();
    const res = await post({ nom: "Diallo", prenom: "Awa", email: `  ${email.toUpperCase()} ` }, adminToken);
    assert.equal(res.status, 201);
    const body = await res.json();

    // Réponse : utilisateur public, statut de l'email, aucun secret
    assert.equal(body.user.email, email);
    assert.equal(body.user.status, "INVITED");
    assert.equal(body.user.role, "USER");
    assert.equal(body.invitation.emailStatus, "accepted_by_provider");
    for (const secret of ["password", "tokenHash", "token", "invitations"]) {
      assert.equal(secret in body.user, false);
    }

    // Email simulé : destinataire, sujet, clé d'idempotence
    assert.equal(ctx.sendCalls.length, 1);
    const call = ctx.sendCalls[0];
    assert.equal(call.payload.to, email);
    assert.equal(call.payload.subject, "Ticket API — Invitation à rejoindre la plateforme");
    const token = tokenFromEmail(call);
    assert.equal(JSON.stringify(body).includes(token), false);

    // Base : pas de mot de passe, seul le hash du jeton est stocké
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { invitations: true } });
    assert.equal(user.password, null);
    assert.equal(user.invitations.length, 1);
    const invitation = user.invitations[0];
    assert.equal(invitation.tokenHash, sha256(token));
    assert.equal(invitation.usedAt, null);
    assert.deepEqual(call.options, { idempotencyKey: `invitation-${invitation.id}` });

    const validityMs = INVITATION_VALIDITY_HOURS * 60 * 60 * 1000;
    assert.ok(invitation.expiresAt.getTime() >= before + validityMs);
    assert.ok(invitation.expiresAt.getTime() <= Date.now() + validityMs);
  });

  test("ignore un rôle envoyé par le client", async () => {
    const res = await post({ nom: "N", prenom: "P", email: ctx.testEmail("role"), role: "SUPER_ADMIN" }, adminToken);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).user.role, "USER");
  });

  test("affiche l'URL publique de l'API dans l'email quand elle est configurée", async () => {
    process.env.API_PUBLIC_URL = "https://api.example.com";
    const res = await post({ nom: "N", prenom: "P", email: ctx.testEmail("url") }, adminToken);
    assert.equal(res.status, 201);
    assert.match((ctx.sendCalls[0].payload as { text: string }).text, /POST https:\/\/api\.example\.com\/auth\/accept-invitation/);
  });

  test("retourne 409 pour un email déjà utilisé, quelle que soit la casse, sans nouvel envoi", async () => {
    const email = ctx.testEmail("dup");
    assert.equal((await post({ nom: "N", prenom: "P", email }, adminToken)).status, 201);
    ctx.sendCalls = [];

    const res = await post({ nom: "N", prenom: "P", email: email.toUpperCase() }, adminToken);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "A user with this email already exists" });
    assert.equal(ctx.sendCalls.length, 0);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { invitations: true } });
    assert.equal(user.invitations.length, 1);
  });
});

describe("POST /users : créations simultanées", () => {
  test("deux requêtes simultanées avec le même email créent un seul utilisateur", async () => {
    const email = ctx.testEmail("race");
    const responses = await Promise.all([1, 2].map(() => post({ nom: "N", prenom: "P", email }, adminToken)));
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal(await prisma.invitation.count({ where: { user: { email } } }), 1);
  });
});

describe("POST /users : échec de l'envoi", () => {
  test("refus de Resend : utilisateur créé, emailStatus failed, aucun secret dans les logs", async () => {
    const logged: unknown[] = [];
    mock.method(console, "error", (...args: unknown[]) => logged.push(...args));
    ctx.nextResponse = async () => ({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "You can only send testing emails to x@y.z" },
      headers: null,
    });

    const email = ctx.testEmail("fail");
    const res = await post({ nom: "N", prenom: "P", email }, adminToken);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.invitation.emailStatus, "failed");
    assert.equal(body.invitation.message, "The invitation email could not be sent. Use POST /users/:id/invitation to retry");
    assert.equal(JSON.stringify(body).includes("testing emails"), false); // détail fournisseur non exposé

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { invitations: true } });
    assert.equal(user.status, "INVITED");
    assert.equal(user.invitations[0].usedAt, null);

    const token = tokenFromEmail(ctx.sendCalls[0]);
    const logText = JSON.stringify(logged);
    assert.ok(logText.includes("validation_error"));
    for (const secret of [token, user.invitations[0].tokenHash, email, "re_fake_test_key"]) {
      assert.equal(logText.includes(secret), false);
    }
  });

  test("configuration Resend absente : utilisateur créé, emailStatus failed, Resend non appelé", async () => {
    mock.method(console, "error", () => {});
    delete process.env.RESEND_API_KEY;
    const res = await post({ nom: "N", prenom: "P", email: ctx.testEmail("noconfig") }, adminToken);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).invitation.emailStatus, "failed");
    assert.equal(ctx.sendCalls.length, 0);
  });

  test("exception pendant l'envoi : utilisateur créé, emailStatus failed", async () => {
    mock.method(console, "error", () => {});
    ctx.nextResponse = async () => {
      throw new Error("socket hang up");
    };
    const res = await post({ nom: "N", prenom: "P", email: ctx.testEmail("throw") }, adminToken);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).invitation.emailStatus, "failed");
  });
});
