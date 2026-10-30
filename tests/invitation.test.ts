import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { INVITATION_VALIDITY_HOURS } from "../src/services/invitation.service";
import { createTestContext, sha256, tokenFromEmail } from "./helpers/testContext";

// Acceptation (POST /auth/accept-invitation) et renvoi (POST /users/:id/invitation)
const ctx = createTestContext();
let adminToken: string;
const password = "MotDePasse-Solide-1";

// Crée un utilisateur invité via l'API et renvoie son id et le jeton reçu par email
async function inviteUser(name: string) {
  const res = await ctx.request("POST", "/users", { nom: "Test", prenom: name, email: ctx.testEmail(name) }, adminToken);
  assert.equal(res.status, 201);
  const { user } = await res.json();
  const token = tokenFromEmail(ctx.sendCalls[ctx.sendCalls.length - 1]);
  return { userId: user.id as string, email: user.email as string, token };
}

const accept = (body: unknown) => ctx.request("POST", "/auth/accept-invitation", body);
const resend = (userId: string, token = adminToken) => ctx.request("POST", `/users/${userId}/invitation`, undefined, token);

before(async () => {
  await ctx.start();
  adminToken = (await ctx.createUser({ name: "admin", role: "SUPER_ADMIN" })).accessToken;
});
beforeEach(() => ctx.resetEmail());
afterEach(() => mock.restoreAll());
after(() => ctx.stop());

describe("POST /auth/accept-invitation", () => {
  test("active le compte, hash le mot de passe et permet ensuite le login", async () => {
    const { userId, email, token } = await inviteUser("accept");

    const res = await accept({ token, password });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, "Invitation accepted");
    assert.equal(body.user.id, userId);
    assert.equal(body.user.status, "ACTIVE");
    assert.equal("password" in body.user, false);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { invitations: true } });
    assert.equal(user.status, "ACTIVE");
    assert.notEqual(user.password, password);
    assert.ok(await bcrypt.compare(password, user.password!));
    assert.ok(user.invitations[0].usedAt);

    // Compatibilité avec le login de Personne 1
    const login = await ctx.request("POST", "/auth/login", { email, password });
    assert.equal(login.status, 200);
    assert.ok((await login.json()).accessToken);
  });

  test("refuse un jeton déjà utilisé", async () => {
    const { token } = await inviteUser("reuse");
    assert.equal((await accept({ token, password })).status, 200);

    const res = await accept({ token, password: "Autre-mot-de-passe-2" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid or expired invitation" });
  });

  test("deux acceptations simultanées du même jeton : une seule réussit", async () => {
    const { token } = await inviteUser("race");
    const statuses = (await Promise.all([1, 2].map(() => accept({ token, password })))).map((r) => r.status);
    assert.deepEqual(statuses.sort(), [200, 400]);
  });

  test("refuse un jeton inconnu", async () => {
    const res = await accept({ token: "f".repeat(64), password });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid or expired invitation" });
  });

  test("refuse un jeton expiré sans activer le compte", async () => {
    const { userId, token } = await inviteUser("expired");
    await prisma.invitation.updateMany({ where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    assert.equal((await accept({ token, password })).status, 400);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.status, "INVITED");
    assert.equal(user.password, null);
  });

  test("refuse l'invitation d'un utilisateur désactivé", async () => {
    const { userId, token } = await inviteUser("disabled");
    await prisma.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
    assert.equal((await accept({ token, password })).status, 400);
  });

  test("refuse un mot de passe trop court ou trop long, sans consommer le jeton", async () => {
    const { userId, token } = await inviteUser("weak");

    const short = await accept({ token, password: "court" });
    assert.equal(short.status, 400);
    assert.equal((await short.json()).details[0].field, "password");
    assert.equal((await accept({ token, password: "é".repeat(37) })).status, 400); // 74 octets

    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId } });
    assert.equal(invitation.usedAt, null);
    assert.equal((await accept({ token, password })).status, 200);
  });

  test("refuse un body incomplet ou avec des champs en trop", async () => {
    assert.equal((await accept({ password })).status, 400);
    assert.equal((await accept({ token: "abc", password, status: "ACTIVE" })).status, 400);
  });
});

describe("POST /users/:id/invitation", () => {
  test("expire l'ancien jeton, en crée un nouveau et l'envoie", async () => {
    const { userId, email, token: oldToken } = await inviteUser("resend");
    ctx.sendCalls = [];

    const before = Date.now();
    const res = await resend(userId);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.invitation.emailStatus, "accepted_by_provider");
    assert.equal(JSON.stringify(body).includes("token"), false);

    assert.equal(ctx.sendCalls.length, 1);
    assert.equal(ctx.sendCalls[0].payload.to, email);
    const newToken = tokenFromEmail(ctx.sendCalls[0]);
    assert.notEqual(newToken, oldToken);

    const invitations = await prisma.invitation.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    assert.equal(invitations.length, 2);
    const [oldInvitation, newInvitation] = invitations;
    assert.equal(oldInvitation.tokenHash, sha256(oldToken));
    assert.ok(oldInvitation.expiresAt.getTime() <= Date.now()); // expirée
    assert.equal(oldInvitation.usedAt, null); // pas marquée comme acceptée
    assert.equal(newInvitation.tokenHash, sha256(newToken));
    assert.ok(newInvitation.expiresAt.getTime() >= before + INVITATION_VALIDITY_HOURS * 3600 * 1000);
    assert.deepEqual(ctx.sendCalls[0].options, { idempotencyKey: `invitation-${newInvitation.id}` });

    // L'ancien jeton ne fonctionne plus, le nouveau oui
    assert.equal((await accept({ token: oldToken, password })).status, 400);
    assert.equal((await accept({ token: newToken, password })).status, 200);
  });

  test("permet de réessayer après un échec d'envoi", async () => {
    mock.method(console, "error", () => {});
    ctx.nextResponse = async () => ({
      data: null,
      error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
      headers: null,
    });
    const res = await ctx.request("POST", "/users", { nom: "T", prenom: "R", email: ctx.testEmail("retry") }, adminToken);
    assert.equal((await res.json()).invitation.emailStatus, "failed");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: ctx.testEmail("retry") } });

    ctx.nextResponse = async () => ({ data: { id: "email_ok" }, error: null, headers: null });
    const retry = await resend(user.id);
    assert.equal(retry.status, 201);
    assert.equal((await retry.json()).invitation.emailStatus, "accepted_by_provider");
  });

  test("retourne 409 pour un utilisateur déjà actif", async () => {
    const { userId, token } = await inviteUser("active");
    await accept({ token, password });
    ctx.sendCalls = [];

    const res = await resend(userId);
    assert.equal(res.status, 409);
    assert.equal(ctx.sendCalls.length, 0);
  });

  test("retourne 404 pour un utilisateur inexistant et 400 pour un id invalide", async () => {
    assert.equal((await resend("00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await resend("abc")).status, 400);
  });

  test("est réservé au Super Admin", async () => {
    const { userId } = await inviteUser("forbidden");
    const { accessToken } = await ctx.createUser({ name: "simple" });
    assert.equal((await resend(userId, accessToken)).status, 403);
  });
});
