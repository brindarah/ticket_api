import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { createTestContext } from "./helpers/testContext";

// Injection SQL et validation des données entrantes
describe("Sécurité : injection SQL et validation", () => {
  const ctx = createTestContext();

  before(() => ctx.start());
  beforeEach(() => ctx.resetEmail());
  after(() => ctx.stop());

  test("injection SQL dans l'email du login : refusée par la validation", async () => {
    const res = await ctx.request("POST", "/auth/login", {
      email: "' OR '1'='1' --",
      password: "x",
    });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "VALIDATION_ERROR");
  });

  test("injection SQL dans le mot de passe : traitée comme du texte, connexion refusée", async () => {
    const { user } = await ctx.createUser({ name: "sqli-password", password: "vrai-mot-de-passe" });

    const res = await ctx.request("POST", "/auth/login", {
      email: user.email,
      password: "' OR '1'='1' --",
    });

    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Invalid email or password", code: "UNAUTHORIZED" });
  });

  test("injection SQL dans un email valide : simple texte pour Prisma, la base est intacte", async () => {
    const { user } = await ctx.createUser({ name: "sqli-intact" });

    // Email au format valide mais contenant une apostrophe et un commentaire SQL
    const res = await ctx.request("POST", "/auth/forgot-password", {
      email: "admin'--@example.test",
    });

    assert.equal(res.status, 200);
    // Requête paramétrée : rien n'a été exécuté, l'utilisateur existe toujours
    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(stillThere);
  });

  test("champ inconnu dans le body : refusé", async () => {
    const res = await ctx.request("POST", "/auth/login", {
      email: "someone@example.test",
      password: "x",
      role: "SUPER_ADMIN",
    });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "VALIDATION_ERROR");
  });

  test("nouveau mot de passe trop long (plus de 72 caractères) : refusé", async () => {
    const res = await ctx.request("POST", "/auth/reset-password", {
      token: "a".repeat(64),
      password: "a".repeat(73),
    });

    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "VALIDATION_ERROR");
  });

  test("JSON mal formé : 400 INVALID_JSON", async () => {
    const res = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ pas du json",
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid JSON body", code: "INVALID_JSON" });
  });

  test("body trop gros (plus de 100 ko) : 413 PAYLOAD_TOO_LARGE", async () => {
    const res = await ctx.request("POST", "/auth/login", {
      email: "someone@example.test",
      password: "x".repeat(200_000),
    });

    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), {
      error: "Request body too large",
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  test("l'en-tête X-Powered-By n'est pas envoyé", async () => {
    const res = await ctx.request("GET", "/health");
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});