import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { createTestContext } from "./helpers/testContext";

// VULN-003 : après un logout, l'access token ne doit plus fonctionner
describe("Access token après déconnexion (VULN-003)", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  after(() => ctx.stop());

  test("l'access token est refusé juste après le logout", async () => {
    const { user } = await ctx.createUser({ name: "logout-access" });
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash("MotDePasse2026", 12) },
    });

    const login = await ctx.request("POST", "/auth/login", {
      email: user.email,
      password: "MotDePasse2026",
    });
    const { accessToken, refreshToken } = await login.json();

    // Avant le logout : le token marche
    assert.equal((await ctx.request("GET", "/auth/me", undefined, accessToken)).status, 200);

    // Logout
    assert.equal((await ctx.request("POST", "/auth/logout", { refreshToken })).status, 204);

    // Après le logout : refusé immédiatement
    const res = await ctx.request("GET", "/auth/me", undefined, accessToken);
    assert.equal(res.status, 401);
  });
});
