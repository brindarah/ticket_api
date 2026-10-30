import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { createRefreshToken } from "../src/lib/tokens";
import { createTestContext } from "./helpers/testContext";

// Liste (GET /users) et activation/désactivation (PATCH /users/:id/status)
const ctx = createTestContext();
let admin: { id: string };
let adminToken: string;

const setStatus = (id: string, status: unknown, token = adminToken) =>
  ctx.request("PATCH", `/users/${id}/status`, { status }, token);

before(async () => {
  await ctx.start();
  const created = await ctx.createUser({ name: "admin", role: "SUPER_ADMIN" });
  admin = created.user;
  adminToken = created.accessToken;
});
beforeEach(() => ctx.resetEmail());
after(() => ctx.stop());

describe("GET /users", () => {
  test("retourne la liste paginée sans mot de passe", async () => {
    await ctx.createUser({ name: "list", password: "secret-password" });
    const res = await ctx.request("GET", "/users?limit=100", undefined, adminToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.meta.page, 1);
    assert.equal(body.meta.limit, 100);
    assert.ok(body.meta.total >= 2);
    assert.equal(body.meta.totalPages, Math.ceil(body.meta.total / 100));
    assert.ok(body.data.some((u: { email: string }) => u.email === ctx.testEmail("list")));
    for (const user of body.data) {
      assert.equal("password" in user, false);
    }
  });

  test("filtre par statut et par rôle", async () => {
    await ctx.createUser({ name: "invited", status: "INVITED" });
    const invited = await (await ctx.request("GET", "/users?status=INVITED&limit=100", undefined, adminToken)).json();
    assert.ok(invited.data.length >= 1);
    assert.ok(invited.data.every((u: { status: string }) => u.status === "INVITED"));

    const admins = await (await ctx.request("GET", "/users?role=SUPER_ADMIN&limit=100", undefined, adminToken)).json();
    assert.ok(admins.data.every((u: { role: string }) => u.role === "SUPER_ADMIN"));
  });

  test("retourne 400 pour un filtre ou une pagination invalides", async () => {
    assert.equal((await ctx.request("GET", "/users?status=UNKNOWN", undefined, adminToken)).status, 400);
    assert.equal((await ctx.request("GET", "/users?limit=500", undefined, adminToken)).status, 400);
  });

  test("est réservé au Super Admin", async () => {
    const { accessToken } = await ctx.createUser({ name: "reader" });
    assert.equal((await ctx.request("GET", "/users", undefined, accessToken)).status, 403);
    assert.equal((await ctx.request("GET", "/users")).status, 401);
  });
});

describe("PATCH /users/:id/status", () => {
  test("désactiver révoque les sessions et bloque immédiatement l'access token", async () => {
    const { user, accessToken } = await ctx.createUser({ name: "todisable", password: "secret-password" });
    await createRefreshToken(user.id);
    assert.equal((await ctx.request("GET", "/auth/me", undefined, accessToken)).status, 200);

    const res = await setStatus(user.id, "DISABLED");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.status, "DISABLED");

    assert.equal(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }), 0);
    assert.equal((await ctx.request("GET", "/auth/me", undefined, accessToken)).status, 401);
  });

  test("désactiver un utilisateur invité fait expirer son invitation", async () => {
    const res = await ctx.request("POST", "/users", { nom: "T", prenom: "inv", email: ctx.testEmail("inv") }, adminToken);
    const { user } = await res.json();

    assert.equal((await setStatus(user.id, "DISABLED")).status, 200);
    const invitation = await prisma.invitation.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(invitation.expiresAt.getTime() <= Date.now());
    assert.equal(invitation.usedAt, null);
  });

  test("réactiver un compte qui avait un mot de passe le remet en ACTIVE", async () => {
    const { user } = await ctx.createUser({ name: "reactivate", status: "DISABLED", password: "secret-password" });
    const res = await setStatus(user.id, "ACTIVE");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.status, "ACTIVE");
  });

  test("réactiver un compte sans mot de passe le remet en INVITED, puis le renvoi est possible", async () => {
    const { user } = await ctx.createUser({ name: "nopassword", status: "DISABLED" });
    const res = await setStatus(user.id, "ACTIVE");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.status, "INVITED");
    assert.equal((await ctx.request("POST", `/users/${user.id}/invitation`, undefined, adminToken)).status, 201);
  });

  test("refuse d'activer directement un utilisateur invité", async () => {
    const { user } = await ctx.createUser({ name: "pending", status: "INVITED" });
    const res = await setStatus(user.id, "ACTIVE");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "An invited user is activated by accepting the invitation" });
  });

  test("ne change rien si le statut demandé est déjà le statut actuel", async () => {
    const { user } = await ctx.createUser({ name: "same", password: "secret-password" });
    const res = await setStatus(user.id, "ACTIVE");
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.status, "ACTIVE");
  });

  test("interdit à un Super Admin de changer son propre statut ou celui d'un autre Super Admin", async () => {
    assert.equal((await setStatus(admin.id, "DISABLED")).status, 403);
    const other = await ctx.createUser({ name: "admin2", role: "SUPER_ADMIN" });
    assert.equal((await setStatus(other.user.id, "DISABLED")).status, 403);
    const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } });
    assert.equal(stillActive.status, "ACTIVE");
  });

  test("valide le body et l'identifiant", async () => {
    const { user } = await ctx.createUser({ name: "validation" });
    assert.equal((await setStatus(user.id, "INVITED")).status, 400);
    assert.equal((await ctx.request("PATCH", `/users/${user.id}/status`, { status: "DISABLED", role: "SUPER_ADMIN" }, adminToken)).status, 400);
    assert.equal((await setStatus("abc", "DISABLED")).status, 400);
    assert.equal((await setStatus("00000000-0000-4000-8000-000000000000", "DISABLED")).status, 404);
  });

  test("est réservé au Super Admin", async () => {
    const target = await ctx.createUser({ name: "target" });
    const { accessToken } = await ctx.createUser({ name: "attacker" });
    assert.equal((await setStatus(target.user.id, "DISABLED", accessToken)).status, 403);
  });
});
