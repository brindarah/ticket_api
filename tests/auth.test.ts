import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma";
import { createTestContext, sha256, tokenFromEmail } from "./helpers/testContext";

const PASSWORD = "mot-de-passe-solide";

describe("Authentification et permissions", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  beforeEach(() => ctx.resetEmail());
  after(() => ctx.stop());

  // Crée un utilisateur actif et se connecte avec
  async function loginAs(name: string, role: "SUPER_ADMIN" | "USER" = "USER") {
    const { user } = await ctx.createUser({ name, role, password: PASSWORD });
    const res = await ctx.request("POST", "/auth/login", { email: user.email, password: PASSWORD });
    assert.equal(res.status, 200);
    const body = await res.json();
    return {
      user,
      body,
      accessToken: body.accessToken as string,
      refreshToken: body.refreshToken as string,
    };
  }

  const refresh = (refreshToken: string) =>
    ctx.request("POST", "/auth/refresh", { refreshToken });

  describe("POST /auth/login", () => {
    test("bon mot de passe : renvoie les deux tokens et l'utilisateur, sans mot de passe", async () => {
      const { user, body } = await loginAs("login-ok");

      assert.equal(typeof body.accessToken, "string");
      assert.match(body.refreshToken, /^[a-f0-9]{64}$/);
      assert.deepEqual(body.user, {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: "USER",
      });
    });

    test("le refresh token est stocké hashé, jamais en clair", async () => {
      const { refreshToken } = await loginAs("login-hash");

      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(refreshToken) },
      });
      assert.ok(stored);
      assert.equal(await prisma.refreshToken.count({ where: { tokenHash: refreshToken } }), 0);
    });

    test("mauvais mot de passe et email inconnu : même réponse 401", async () => {
      const { user } = await ctx.createUser({ name: "login-wrong", password: PASSWORD });
      const expected = { error: "Invalid email or password", code: "UNAUTHORIZED" };

      const wrongPassword = await ctx.request("POST", "/auth/login", {
        email: user.email,
        password: "mauvais-mot-de-passe",
      });
      assert.equal(wrongPassword.status, 401);
      assert.deepEqual(await wrongPassword.json(), expected);

      const unknownEmail = await ctx.request("POST", "/auth/login", {
        email: ctx.testEmail("inconnu"),
        password: PASSWORD,
      });
      assert.equal(unknownEmail.status, 401);
      assert.deepEqual(await unknownEmail.json(), expected);
    });

    test("compte INVITED (sans mot de passe) : 401", async () => {
      const { user } = await ctx.createUser({ name: "login-invited", status: "INVITED" });

      const res = await ctx.request("POST", "/auth/login", { email: user.email, password: PASSWORD });
      assert.equal(res.status, 401);
    });

    test("compte DISABLED : 403", async () => {
      const { user } = await ctx.createUser({
        name: "login-disabled",
        status: "DISABLED",
        password: PASSWORD,
      });

      const res = await ctx.request("POST", "/auth/login", { email: user.email, password: PASSWORD });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Account disabled", code: "FORBIDDEN" });
    });
  });

  describe("POST /auth/refresh", () => {
    test("rotation : nouveaux tokens, l'ancien refresh token ne marche plus", async () => {
      const { refreshToken } = await loginAs("refresh-rotation");

      const first = await refresh(refreshToken);
      assert.equal(first.status, 200);
      const tokens = await first.json();
      assert.notEqual(tokens.refreshToken, refreshToken);

      const reused = await refresh(refreshToken);
      assert.equal(reused.status, 401);
    });

    test("réutilisation d'un token révoqué : toute la session est révoquée", async () => {
      const { refreshToken } = await loginAs("refresh-theft");

      const { refreshToken: newToken } = await (await refresh(refreshToken)).json();

      // Un « voleur » réutilise l'ancien token...
      assert.equal((await refresh(refreshToken)).status, 401);
      // ... donc le nouveau token du vrai utilisateur est révoqué aussi
      assert.equal((await refresh(newToken)).status, 401);
    });

    test("refresh token expiré : 401", async () => {
      const { refreshToken } = await loginAs("refresh-expired");

      await prisma.refreshToken.update({
        where: { tokenHash: sha256(refreshToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await refresh(refreshToken);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Refresh token expired", code: "UNAUTHORIZED" });
    });

    test("token inconnu : 401", async () => {
      const res = await refresh("a".repeat(64));
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Invalid refresh token", code: "UNAUTHORIZED" });
    });

    test("compte désactivé entre-temps : 403", async () => {
      const { user, refreshToken } = await loginAs("refresh-disabled");
      await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });

      const res = await refresh(refreshToken);
      assert.equal(res.status, 403);
    });
  });

  describe("POST /auth/logout", () => {
    test("204, puis le refresh token ne marche plus", async () => {
      const { refreshToken } = await loginAs("logout");

      const res = await ctx.request("POST", "/auth/logout", { refreshToken });
      assert.equal(res.status, 204);

      assert.equal((await refresh(refreshToken)).status, 401);
    });
  });

  describe("GET /auth/me (middleware authenticate)", () => {
    test("avec un access token valide : renvoie l'utilisateur, sans mot de passe", async () => {
      const { user, accessToken } = await loginAs("me-ok");

      const res = await ctx.request("GET", "/auth/me", undefined, accessToken);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.user.id, user.id);
      assert.equal("password" in body.user, false);
    });

    test("sans token : 401", async () => {
      const res = await ctx.request("GET", "/auth/me");
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Authentication required", code: "UNAUTHORIZED" });
    });

    test("token falsifié : 401", async () => {
      const res = await ctx.request("GET", "/auth/me", undefined, "pas.un.jwt");
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Invalid or expired token", code: "UNAUTHORIZED" });
    });

    test("token signé avec un autre secret : 401", async () => {
      const { user } = await ctx.createUser({ name: "me-forged" });
      const forged = jwt.sign({ sub: user.id, role: "SUPER_ADMIN" }, "autre-secret");

      const res = await ctx.request("GET", "/auth/me", undefined, forged);
      assert.equal(res.status, 401);
    });

    test("token expiré : 401", async () => {
      const { user } = await ctx.createUser({ name: "me-expired" });
      const expired = jwt.sign(
        { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) - 60 },
        process.env.JWT_ACCESS_SECRET!,
      );

      const res = await ctx.request("GET", "/auth/me", undefined, expired);
      assert.equal(res.status, 401);
    });

    test("compte désactivé avec un access token encore valide : 401", async () => {
      const { accessToken } = await ctx.createUser({ name: "me-disabled", status: "DISABLED" });

      const res = await ctx.request("GET", "/auth/me", undefined, accessToken);
      assert.equal(res.status, 401);
    });
  });

  describe("POST /users/super-admin (middleware authorize)", () => {
    test("un USER : 403", async () => {
      const { accessToken } = await loginAs("authorize-user", "USER");

      const res = await ctx.request(
        "POST",
        "/users/super-admin",
        { nom: "Test", prenom: "Refus", email: ctx.testEmail("refused-admin") },
        accessToken,
      );
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Forbidden", code: "FORBIDDEN" });
    });

    test("un SUPER_ADMIN : 201, nouveau Super Admin invité", async () => {
      const { accessToken } = await loginAs("authorize-admin", "SUPER_ADMIN");

      const res = await ctx.request(
        "POST",
        "/users/super-admin",
        { nom: "Test", prenom: "Nouveau", email: ctx.testEmail("new-admin") },
        accessToken,
      );
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.user.role, "SUPER_ADMIN");
      assert.equal(body.user.status, "INVITED");
    });
  });

  describe("Reset de mot de passe et sessions", () => {
    test("après un reset, les anciennes sessions sont révoquées", async () => {
      const { user, refreshToken } = await loginAs("reset-revoke");

      await ctx.request("POST", "/auth/forgot-password", { email: user.email });
      const token = tokenFromEmail(ctx.sendCalls[0]);

      const reset = await ctx.request("POST", "/auth/reset-password", {
        token,
        password: "nouveau-mot-de-passe",
      });
      assert.equal(reset.status, 200);

      assert.equal((await refresh(refreshToken)).status, 401);
    });
  });
});